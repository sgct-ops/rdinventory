"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { savePOAction, importPOsAction, setPOStatusAction } from "@/app/actions";
import { ScanInput } from "./ScanInput";
import { beep } from "./ScanBox";

type Fab = { id: string; fabricNo: string; sku: string | null; label: string };
type Line = { item: string; kg: string; rolls: string };

/** Add an incoming PO by hand, or import many from a Zoho / Carbonwork CSV export. */
export function POEditor({ fabrics, initialPO, initial }: { fabrics: Fab[]; initialPO?: string; initial?: { vendor: string | null; expectedDate: string | null; lines: Line[] } }) {
  const router = useRouter();
  const [po, setPo] = useState(initialPO ?? "");
  const [vendor, setVendor] = useState(initial?.vendor ?? "");
  const [date, setDate] = useState(initial?.expectedDate ?? "");
  const [lines, setLines] = useState<Line[]>(initial?.lines?.length ? initial.lines : [{ item: "", kg: "", rolls: "" }]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const find = (q: string) => { const k = q.trim().toUpperCase(); return fabrics.find((f) => f.fabricNo.toUpperCase() === k) ?? fabrics.find((f) => (f.sku ?? "").toUpperCase() === k); };
  const setLine = (i: number, x: Partial<Line>) => setLines((o) => o.map((l, j) => (j === i ? { ...l, ...x } : l)));

  async function save() {
    setBusy(true); setMsg(null);
    const r = await savePOAction({ poNumber: po, vendor, expectedDate: date || undefined, lines: lines.filter((l) => l.item.trim()) });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.error }); beep(false); return; }
    beep(true); setMsg({ ok: true, text: `${r.data!.po} ${r.data!.created ? "added" : "updated"}.` });
    router.push(`/pos?q=${encodeURIComponent(r.data!.po)}`); router.refresh();
  }
  async function importFile(file: File, source: string) {
    setBusy(true); setMsg(null);
    const r = await importPOsAction(await file.text(), source);
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    setMsg({ ok: !r.data!.failed.length, text: `${r.data!.done.length} PO${r.data!.done.length === 1 ? "" : "s"} imported${r.data!.failed.length ? `. Problems:\n${r.data!.failed.join("\n")}` : "."}` });
    router.refresh();
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <section className="card p-5 flex flex-col gap-3 min-w-0">
        <div className="font-semibold">Add or update a PO</div>
        <div className="grid sm:grid-cols-3 gap-3">
          <div><label className="label">Fabric PO *</label><ScanInput want="po" mono className="uppercase" value={po} onChange={setPo} placeholder="CT26/PO/48" ariaLabel="PO number" /></div>
          <div><label className="label">Vendor</label><input className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Optional" /></div>
          <div><label className="label">Expected</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <datalist id="po-fablist">{fabrics.map((f) => <option key={f.id} value={f.fabricNo}>{`${f.sku ?? ""} · ${f.label}`}</option>)}</datalist>
        <div className="flex flex-col gap-2">
          {lines.map((l, i) => {
            const f = l.item ? find(l.item) : undefined;
            return (
              <div key={i} className="grid grid-cols-[minmax(0,1.6fr)_110px_90px_28px] gap-2 items-start">
                <div><ScanInput want="sku" list="po-fablist" value={l.item} onChange={(v) => setLine(i, { item: v })} placeholder="Scan SKU or Fabric #" ariaLabel={`PO line ${i + 1} fabric`} />
                  <div className={`text-[11px] mt-0.5 ${l.item && !f ? "text-bad" : "text-muted"}`}>{l.item ? (f ? `${f.label}${f.sku ? " · " + f.sku : ""}` : "Not in Fabric Inventory") : ""}</div></div>
                <input className="input text-right" inputMode="decimal" placeholder="kg" value={l.kg} onChange={(e) => setLine(i, { kg: e.target.value })} aria-label={`PO line ${i + 1} kg`} />
                <input className="input text-right" inputMode="numeric" placeholder="rolls" value={l.rolls} onChange={(e) => setLine(i, { rolls: e.target.value })} aria-label={`PO line ${i + 1} rolls`} />
                <button className="text-faint text-xl mt-2 hover:text-bad" onClick={() => setLines((o) => (o.length > 1 ? o.filter((_, j) => j !== i) : [{ item: "", kg: "", rolls: "" }]))} aria-label="Remove line">×</button>
              </div>);
          })}
          <button className="self-start text-sm text-ok font-semibold" onClick={() => setLines((o) => [...o, { item: "", kg: "", rolls: "" }])}>+ Add fabric</button>
        </div>
        <div className="flex gap-2 items-center"><button className="btn" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save PO"}</button>
          {msg && <div className={`text-sm whitespace-pre-wrap rounded-md px-3 py-2 ${msg.ok ? "bg-okbg" : "bg-badbg text-bad"}`}>{msg.text}</div>}</div>
      </section>
      <section className="card p-5 flex flex-col gap-3 min-w-0">
        <div className="font-semibold">Import from Zoho or Carbonwork</div>
        <div className="text-sm text-muted">Export the open fabric POs as CSV with one row per fabric line. Columns (names matched loosely): <span className="mono text-ink">po, fabric</span> (Fabric #, SKU, Zoho item ID or item name)<span className="mono text-ink">, kg</span>, and optionally <span className="mono text-ink">rolls, vendor, expected_date</span>. Importing a PO again replaces its lines.</div>
        <div className="flex flex-wrap gap-2">
          {["ZOHO", "CARBONWORK", "CSV"].map((s) => (
            <label key={s} className="btn-ghost cursor-pointer">{s === "CSV" ? "Other CSV" : `${s === "ZOHO" ? "Zoho" : "Carbonwork"} CSV`}
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f, s); e.target.value = ""; }} /></label>))}
        </div>
        <div className="text-xs text-muted">Automatic sync: POST the same rows as JSON to <span className="mono">/api/sync/pos</span> with the <span className="mono">PO_API_KEY</span> secret (see README).</div>
      </section>
    </div>
  );
}

export function POStatusButton({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  return <button className="btn-ghost btn-sm" onClick={async () => { const r = await setPOStatusAction(id, status === "OPEN" ? "CLOSED" : "OPEN"); if (r.ok) router.refresh(); }}>{status === "OPEN" ? "Close PO" : "Reopen"}</button>;
}
