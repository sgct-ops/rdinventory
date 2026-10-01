"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { receivePOAction, saveDraftAction, discardDraftAction, poSummaryAction } from "@/app/actions";
import type { POView } from "@/lib/purchasing";
import { kg, beep } from "./ScanBox";
import { ScanInput } from "./ScanInput";

type Fab = { id: string; fabricNo: string; sku: string | null; fabric: string; colour: string };
type Line = { item: string; batch: string; weights: string[] };
type Draft = { fpo: string; inv: string; date: string; loc: string; ch: string; note: string; lines: Line[] };
type Result = { po: string; receipt: string; invoiceNo: string; location: string; rolls: number; kgG: number; batches: { fabricNo: string; fabric: string; colour: string; batch: string; serials: string[]; kgG: number }[] };

const blank = (): Line => ({ item: "", batch: "", weights: [""] });
const findFab = (list: Fab[], q: string) => {
  const k = q.trim().toUpperCase().split(" · ")[0].trim();
  return k ? list.find((f) => f.fabricNo.toUpperCase() === k) ?? list.find((f) => (f.sku ?? "").toUpperCase() === k) ?? null : null;
};
const okW = (w: string) => { const n = Number(w.replace(",", ".")); return n > 0 && n <= 80; };
const g = (w: string) => Math.round((Number(w.replace(",", ".")) || 0) * 1000);

export function ReceiveForm(p: {
  fabrics: Fab[]; locations: { id: string; name: string }[]; fixedLocation: { id: string; name: string } | null; userName: string;
  today: string; draft: Draft | null; isAdmin: boolean; canEditPOs: boolean; batchMax: Record<string, number>;
}) {
  const defLoc = p.fixedLocation?.id ?? (p.locations.length === 1 ? p.locations[0].id : "");
  const empty: Draft = { fpo: "", inv: "", date: p.today, loc: defLoc, ch: "", note: "", lines: [blank()] };
  const [d, setD] = useState<Draft>(() => ({ ...empty, ...(p.draft ?? {}), loc: p.fixedLocation?.id ?? p.draft?.loc ?? defLoc }));
  const [errs, setErrs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [over, setOver] = useState<string[] | null>(null);
  const [po, setPo] = useState<{ q: string; view: POView | null; loading: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => saveDraftAction("RECEIVE", d), 800);
    return () => clearTimeout(t);
  }, [d]);
  // look the PO up as you type / scan it
  useEffect(() => {
    const q = d.fpo.trim().toUpperCase();
    if (!q) { setPo(null); return; }
    setPo((o) => ({ q, view: o?.q === q ? o.view : null, loading: true }));
    const t = setTimeout(async () => {
      const r = await poSummaryAction(q);
      setPo({ q, view: r.ok ? (r.data as POView | null) : null, loading: false });
    }, 300);
    return () => clearTimeout(t);
  }, [d.fpo]);

  const set = (x: Partial<Draft>) => setD((o) => ({ ...o, ...x }));
  const setLine = (i: number, x: Partial<Line>) => setD((o) => ({ ...o, lines: o.lines.map((l, j) => (j === i ? { ...l, ...x } : l)) }));
  const ws = (l: Line) => l.weights.map((w) => w.trim()).filter(Boolean);
  const totalRolls = d.lines.reduce((a, l) => a + ws(l).length, 0);
  const totalKg = d.lines.reduce((a, l) => a + ws(l).reduce((s, w) => s + (Number(w) || 0), 0), 0);
  const view = po?.view ?? null;
  const poKnown = !!view && !po?.loading;
  const poMissing = !!po && !po.loading && !view && !!d.fpo.trim();
  const lineFor = (f: Fab | null) => (f && view ? view.lines.find((l) => l.fabricItemId === f.id) ?? null : null);

  const autoBatch = (() => {
    const used: Record<string, number> = {};
    return d.lines.map((l) => {
      const f = findFab(p.fabrics, l.item);
      if (!f || !d.fpo || l.batch) return "";
      const base = `B-${d.fpo.toUpperCase().replace(/[^A-Z0-9]/g, "")}-${f.fabricNo.toUpperCase()}-`;
      used[base] = (used[base] ?? 0) + 1;
      return base + String((p.batchMax[base] ?? 0) + used[base]).padStart(2, "0");
    });
  })();

  async function submit(allowOver = false) {
    const bad = d.lines.map((l, i) => {
      if (!l.item && !ws(l).length) return "";
      const f = findFab(p.fabrics, l.item);
      if (!f) return `fabric ${i + 1}: pick the fabric`;
      if (view && !lineFor(f)) return `fabric ${i + 1}: ${f.fabricNo} isn't on ${view.poNumber}`;
      if (!ws(l).length) return `fabric ${i + 1}: add roll weights`;
      if (ws(l).some((w) => !okW(w))) return `fabric ${i + 1}: a weight is not 0–80 kg`;
      return "";
    }).filter(Boolean);
    if (!d.inv.trim()) bad.unshift("the invoice # (required)");
    if (bad.length) { setErrs([`Fix ${bad.join("; ")}.`]); beep(false); return; }
    setBusy(true); setErrs([]); setOver(null);
    const r = await receivePOAction({ fabricPO: d.fpo, invoiceNo: d.inv, date: d.date, locationId: d.loc, challan: d.ch, note: d.note, allowOver,
      lines: d.lines.map((l) => ({ item: l.item, batch: l.batch, weights: ws(l) })) });
    setBusy(false);
    if (!r.ok) { setErrs([r.error]); beep(false); return; }
    const data = r.data!;
    if (!data.ok) { if (data.over?.length) setOver(data.errors); else setErrs(data.errors); beep(false); return; }
    beep(true);
    setRes(data as Result);
    first.current = true;
    setD({ ...empty, loc: d.loc });
  }

  if (res) return (
    <div className="p-4 lg:p-7 flex flex-col gap-4 max-w-4xl">
      <div className="card border-ok bg-okbg p-5">
        <div className="kicker text-ok">RECEIVED · {res.receipt}</div>
        <div className="text-2xl font-semibold mt-1">{res.po} · {res.rolls} rolls · {kg(res.kgG, 2)} kg</div>
        <div className="text-sm mt-1">Invoice <b className="mono">{res.invoiceNo}</b> at {res.location}. Every roll waits in the label queue until its label is scanned — at Rajdanga Storage, the put-away scan does that.</div>
      </div>
      {res.batches.map((b, i) => (
        <div key={i} className="card p-4">
          <div className="flex items-baseline gap-3 flex-wrap"><div className="font-semibold">{b.fabricNo} · {b.fabric} {b.colour}</div>
            <div className="text-sm text-muted">Batch <span className="mono">{b.batch}</span> · {b.serials.length} roll{b.serials.length === 1 ? "" : "s"} · {kg(b.kgG, 2)} kg</div></div>
          <div className="flex gap-2 flex-wrap mt-3">{b.serials.map((s) => <Link key={s} href={`/rolls/${s}`} className="mono text-sm bg-okbg rounded-full px-3 py-1">{s}</Link>)}</div>
        </div>))}
      {msg && <div className="text-sm bg-okbg rounded-md px-3 py-2">{msg}</div>}
      <div className="flex gap-2 flex-wrap">
        {p.isAdmin && <button className="btn-ghost" onClick={() => {
          window.open(`/api/labels/rolls?serials=${res.batches.flatMap((b) => b.serials).join(",")}`, "_blank");
          setMsg("Labels PDF opened. The barcode holds serial, invoice and batch. They stay in the queue until each one is scanned.");
        }}>Print these labels</button>}
        <Link href="/warehouse/put" className="btn-ghost">Put away</Link>
        <Link href={`/pos?q=${encodeURIComponent(res.po)}`} className="btn-ghost">See {res.po}</Link>
        <button className="btn" onClick={() => setRes(null)}>Receive more</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-[calc(100vh-60px)] flex flex-col">
      <div className="p-4 lg:p-7 flex flex-col gap-5 max-w-5xl w-full mx-auto flex-1">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-[260px]"><span className="pill bg-okbg text-ok font-semibold">PO RECEIVING</span>
            <div className="h1 mt-2">Receive a fabric PO</div>
            <div className="sub max-w-xl">Scan or type the PO: the app knows what it brings. Then scan each fabric&apos;s SKU (or type its Fabric #) and the roll weights. A PO can come in several parts — receive each part with its own invoice.</div></div>
          <div className="text-right"><div className="kicker">THIS RECEIPT</div><div className="text-2xl font-semibold">{totalRolls} rolls</div><div className="text-xs text-muted">{totalKg.toFixed(2)} kg · {d.lines.filter((l) => l.item).length} fabrics</div></div>
        </div>

        <section className="card p-5 flex flex-col gap-4">
          <div className="font-semibold"><span className="step">1</span>Purchase order and invoice</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <F label="Fabric PO *"><ScanInput want="po" mono className="uppercase" placeholder="CT26/PO/48 or PO-112" value={d.fpo} onChange={(v) => set({ fpo: v })} ariaLabel="Fabric PO" /></F>
            <F label="Invoice # *"><ScanInput want="invoice" mono className="uppercase" placeholder="Vendor invoice number" value={d.inv} onChange={(v) => set({ inv: v })} ariaLabel="Invoice number" /></F>
            <F label="Date received *"><input className="input" type="date" max={p.today} value={d.date} onChange={(e) => set({ date: e.target.value })} /></F>
            <F label="Received at *">{p.fixedLocation
              ? <div className="input flex items-center bg-[#f6f5f2] text-ink font-medium" title="Your login receives fabric only here">{p.fixedLocation.name}<span className="ml-auto text-[11px] text-muted">fixed for your login</span></div>
              : <select className="input" value={d.loc} onChange={(e) => set({ loc: e.target.value })}><option value="">Select location</option>{p.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}</F>
            <F label="Weighed by"><div className="input flex items-center bg-[#f6f5f2]" title="Filled from the person signed in">{p.userName}<span className="ml-auto text-[11px] text-muted">signed in</span></div></F>
            <F label="Challan #"><input className="input" placeholder="Optional" value={d.ch} onChange={(e) => set({ ch: e.target.value })} /></F>
          </div>
          {po?.loading && <div className="text-sm text-muted">Looking up {po.q}…</div>}
          {poMissing && (
            <div className="rounded-lg bg-badbg text-bad px-4 py-3 text-sm">
              <b>{d.fpo.trim().toUpperCase()} isn&apos;t in Incoming POs</b>, so the app doesn&apos;t know what it brings. {p.canEditPOs ? <>Add it (or import it from Zoho / Carbonwork) on <Link href={`/pos?new=${encodeURIComponent(d.fpo.trim().toUpperCase())}`} className="underline font-semibold">Incoming POs</Link>.</> : "Ask the office to add it to Incoming POs."}
            </div>)}
          {poKnown && view && <POCard v={view} />}
        </section>

        <section className="card p-5 flex flex-col gap-3">
          <div className="flex items-baseline gap-3 flex-wrap"><div className="font-semibold"><span className="step">2</span>Fabrics and rolls</div>
            <div className="text-xs text-muted">One card per fabric. Press the barcode button and scan the fabric&apos;s SKU barcode — the app checks it&apos;s on this PO. Then type each roll weight and press Enter.</div></div>
          <datalist id="fablist">
            {(view ? p.fabrics.filter((f) => view.lines.some((l) => l.fabricItemId === f.id)) : p.fabrics).map((f) => <option key={f.id} value={f.fabricNo}>{`${f.sku ?? ""} · ${f.fabric} ${f.colour}`}</option>)}
          </datalist>
          {d.lines.map((l, i) => {
            const f = findFab(p.fabrics, l.item);
            const line = lineFor(f);
            const notOnPO = !!f && !!view && !line;
            const weights = l.weights[l.weights.length - 1]?.trim() ? [...l.weights, ""] : l.weights;
            const kgs = ws(l);
            const thisG = kgs.reduce((a, w) => a + g(w), 0);
            return (
              <div key={i} className={`border rounded-xl p-4 ${notOnPO ? "border-bad bg-badbg/40" : "border-line focus-within:border-ok"}`}>
                <div className="grid grid-cols-[28px_minmax(0,1.3fr)_minmax(0,1fr)_32px] gap-4 items-start max-md:grid-cols-[28px_minmax(0,1fr)_32px]">
                  <div className="w-7 h-7 rounded-lg bg-chip text-muted text-xs font-bold grid place-items-center mt-6">{i + 1}</div>
                  <div><label className="label">Fabric (SKU barcode or Fabric #)</label>
                    <ScanInput want="sku" list="fablist" placeholder="Scan SKU or type Fabric #" value={l.item} ariaLabel={`Fabric ${i + 1}`}
                      onChange={(v) => setLine(i, { item: v })}
                      onScan={(v) => { const ff = findFab(p.fabrics, v); if (!ff) { beep(false); return; } if (view && !view.lines.some((x) => x.fabricItemId === ff.id)) { beep(false); return; } beep(true);
                        setTimeout(() => (document.querySelector(`[data-w="${i}-0"]`) as HTMLInputElement | null)?.focus(), 0); }} />
                    <div className={`text-xs mt-1 ${(l.item && !f) || notOnPO ? "text-bad font-medium" : "text-muted"}`}>
                      {!l.item ? "" : !f ? "Not in Fabric Inventory" : notOnPO ? `✕ ${view!.poNumber} has no ${f.fabricNo} (${f.sku ?? f.fabric}) to receive. It brings: ${view!.lines.map((x) => x.fabricNo).join(", ")}.`
                        : `${f.fabric} · ${f.colour}${f.sku ? "  ·  " + f.sku : ""}`}</div>
                    {line && <LineBar line={line} thisG={thisG} />}
                  </div>
                  <div className="max-md:col-start-2"><label className="label">Batch</label>
                    <input className="input mono uppercase" placeholder={autoBatch[i] ? `Auto: ${autoBatch[i]}` : "Auto (needs PO and fabric)"} value={l.batch} onChange={(e) => setLine(i, { batch: e.target.value })} disabled={notOnPO} />
                    <div className="text-xs text-muted mt-1">{l.batch ? "Adding to an existing batch" : "Leave empty for a new batch"}</div></div>
                  <button className="text-faint text-xl mt-6 hover:text-bad max-md:row-start-1 max-md:col-start-3" title="Remove fabric" onClick={() => setD((o) => ({ ...o, lines: o.lines.length > 1 ? o.lines.filter((_, j) => j !== i) : [blank()] }))}>×</button>
                </div>
                <label className="label mt-4">Roll weights (kg)</label>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                  {weights.map((w, j) => (
                    <input key={j} data-w={`${i}-${j}`} inputMode="decimal" value={w} placeholder={j === weights.length - 1 ? "+ kg" : "kg"} disabled={notOnPO}
                      className={`input h-11 text-right font-semibold ${w && !okW(w) ? "border-bad bg-badbg" : ""} ${!w ? "border-dashed" : ""}`}
                      onChange={(e) => {
                        const v = e.target.value;
                        const parts = v.trim().split(/[\s,;]+/).filter(Boolean);
                        const next = [...weights]; next.splice(j, 1, ...(parts.length > 1 ? parts : [v]));
                        setLine(i, { weights: next.filter((x, k) => x !== "" || k === next.length - 1) });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); setTimeout(() => (document.querySelector(`[data-w="${i}-${j + 1}"]`) as HTMLInputElement | null)?.focus(), 0); }
                        if (e.key === "Backspace" && !w && j > 0) { e.preventDefault(); setLine(i, { weights: weights.filter((_, k) => k !== j) }); setTimeout(() => (document.querySelector(`[data-w="${i}-${j - 1}"]`) as HTMLInputElement | null)?.focus(), 0); }
                      }} />
                  ))}
                </div>
                <div className="flex gap-5 mt-2 text-xs text-muted"><span><b className="text-ink text-sm">{kgs.length}</b> roll{kgs.length === 1 ? "" : "s"}</span>
                  <span><b className="text-ink text-sm">{(thisG / 1000).toFixed(2)}</b> kg</span>
                  {kgs.some((w) => !okW(w)) && <span className="text-bad">check the red weights (0–80 kg)</span>}</div>
              </div>
            );
          })}
          <button className="self-start h-10 px-4 rounded-lg border border-dashed border-[#c9cfca] text-ok font-semibold hover:bg-okbg" onClick={() => setD((o) => ({ ...o, lines: [...o.lines, blank()] }))}>+ Add another fabric</button>
          <F label="Note"><input className="input" placeholder="Optional" value={d.note} onChange={(e) => set({ note: e.target.value })} /></F>
        </section>
      </div>
      {over && (
        <div className="fixed inset-0 z-[60] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="More than the PO">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOver(null)} />
          <div className="relative card p-5 max-w-md w-full shadow-2xl">
            <div className="font-semibold text-lg">More than the PO expects</div>
            <ul className="text-sm mt-2 list-disc pl-5">{over.map((o) => <li key={o}>{o}</li>)}</ul>
            <div className="text-sm text-muted mt-2">Check the weights. If the vendor really sent more, receive it anyway — it&apos;s recorded.</div>
            <div className="flex gap-2 justify-end mt-4"><button className="btn-ghost" onClick={() => setOver(null)}>Go back</button><button className="btn" onClick={() => submit(true)}>Receive anyway</button></div>
          </div>
        </div>)}
      <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-line px-4 lg:px-7 py-3 flex gap-2 items-center flex-wrap">
        <div className="flex-1 min-w-[200px]">{errs.length > 0 && <div className="text-sm bg-badbg text-bad rounded-md px-3 py-2 whitespace-pre-wrap">{errs.join("\n")}</div>}</div>
        <button className="btn-ghost" onClick={async () => { if (!confirm("Clear this receipt?")) return; await discardDraftAction("RECEIVE"); first.current = true; setD(empty); }}>Clear</button>
        <button className="btn h-12 px-6 text-base" disabled={busy || poMissing || view?.status === "CLOSED"} onClick={() => submit(false)}>{busy ? "Receiving…" : "Receive and create rolls"}</button>
      </div>
    </div>
  );
}

function POCard({ v }: { v: POView }) {
  const pct = v.expectedG ? Math.min(100, Math.round((v.receivedG / v.expectedG) * 100)) : 0;
  return (
    <div className="rounded-xl border border-line overflow-hidden">
      <div className="flex items-center gap-3 flex-wrap px-4 py-3 bg-[#faf9f6] border-b border-line">
        <b className="mono">{v.poNumber}</b>{v.vendor && <span className="text-sm text-muted">{v.vendor}</span>}
        <span className={`pill ${v.status === "CLOSED" ? "bg-chip" : "bg-okbg text-ok"}`}>{v.status === "CLOSED" ? "Closed" : "Open"}</span>
        <span className="text-sm ml-auto"><b>{kg(v.receivedG, 1)}</b> of {kg(v.expectedG, 1)} kg received · {v.receipts.length} receipt{v.receipts.length === 1 ? "" : "s"} so far</span>
        <div className="w-full h-1.5 rounded bg-line2"><div className="h-full rounded bg-ok" style={{ width: `${pct}%` }} /></div>
      </div>
      <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>FABRIC #</th><th>SKU</th><th>ITEM</th><th className="text-right">EXPECTED</th><th className="text-right">RECEIVED</th><th className="text-right">STILL TO COME</th></tr></thead>
        <tbody>{v.lines.map((l) => (
          <tr key={l.id}><td className="mono font-medium">{l.fabricNo}</td><td className="mono text-xs">{l.sku}</td><td>{l.item}{l.colour ? ` · ${l.colour}` : ""}</td>
            <td className="text-right">{kg(l.expectedG, 1)}{l.expectedRolls ? <span className="text-muted text-xs"> · {l.expectedRolls} rolls</span> : ""}</td>
            <td className="text-right">{kg(l.receivedG, 1)}<span className="text-muted text-xs"> · {l.receivedRolls}</span></td>
            <td className={`text-right font-semibold ${l.done ? "text-ok" : ""}`}>{l.done ? "✓ done" : kg(l.leftG, 1)}</td></tr>))}</tbody></table></div>
      <div className="px-4 py-2 text-xs text-muted border-t border-line2">The app checks each fabric you scan against these lines. It won&apos;t fill them in for you.</div>
    </div>
  );
}

function LineBar({ line, thisG }: { line: POView["lines"][number]; thisG: number }) {
  const after = line.receivedG + thisG;
  const pct = (x: number) => Math.min(100, (x / Math.max(1, line.expectedG)) * 100);
  return (
    <div className="mt-2">
      <div className="h-2 rounded bg-line2 relative overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-ok/60" style={{ width: `${pct(line.receivedG)}%` }} />
        <div className={`absolute inset-y-0 ${after > line.expectedG * 1.1 ? "bg-warn" : "bg-ok"}`} style={{ left: `${pct(line.receivedG)}%`, width: `${Math.max(0, pct(after) - pct(line.receivedG))}%` }} />
      </div>
      <div className="text-[11px] text-muted mt-1">On the PO {kg(line.expectedG, 1)} kg · came before {kg(line.receivedG, 1)} · this receipt {kg(thisG, 1)} · {after > line.expectedG ? <b className="text-[oklch(0.5_0.12_70)]">{kg(after - line.expectedG, 1)} kg over</b> : <>still to come {kg(line.expectedG - after, 1)}</>}</div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  const req = label.endsWith("*");
  return <div className="min-w-0"><label className="label">{req ? label.slice(0, -1) : label}{req && <span className="text-bad"> *</span>}</label>{children}</div>;
}
