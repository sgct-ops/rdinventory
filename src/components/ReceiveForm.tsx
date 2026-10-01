"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { receivePOAction, saveDraftAction, discardDraftAction } from "@/app/actions";
import { kg, beep } from "./ScanBox";

type Fab = { id: string; fabricNo: string; sku: string | null; fabric: string; colour: string };
type Line = { item: string; batch: string; weights: string[] };
type Draft = { fpo: string; date: string; loc: string; wby: string; ch: string; note: string; lines: Line[] };
type Result = { po: string; location: string; rolls: number; kgG: number; batches: { fabricNo: string; fabric: string; colour: string; batch: string; serials: string[]; kgG: number }[] };

const blank = (): Line => ({ item: "", batch: "", weights: [""] });
const findFab = (list: Fab[], q: string) => {
  const k = q.trim().toUpperCase().split(" · ")[0].trim();
  return k ? list.find((f) => f.fabricNo.toUpperCase() === k) ?? list.find((f) => (f.sku ?? "").toUpperCase() === k) ?? null : null;
};
const okW = (w: string) => { const n = Number(w.replace(",", ".")); return n > 0 && n <= 80; };

export function ReceiveForm(p: { fabrics: Fab[]; locations: { id: string; name: string }[]; today: string; draft: Draft | null; isAdmin: boolean; batchMax: Record<string, number> }) {
  const empty: Draft = { fpo: "", date: p.today, loc: p.locations.length === 1 ? p.locations[0].id : "", wby: "", ch: "", note: "", lines: [blank()] };
  const [d, setD] = useState<Draft>(p.draft ?? empty);
  const [errs, setErrs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => saveDraftAction("RECEIVE", d), 800);
    return () => clearTimeout(t);
  }, [d]);
  const set = (x: Partial<Draft>) => setD((o) => ({ ...o, ...x }));
  const setLine = (i: number, x: Partial<Line>) => setD((o) => ({ ...o, lines: o.lines.map((l, j) => (j === i ? { ...l, ...x } : l)) }));
  const ws = (l: Line) => l.weights.map((w) => w.trim()).filter(Boolean);
  const totalRolls = d.lines.reduce((a, l) => a + ws(l).length, 0);
  const totalKg = d.lines.reduce((a, l) => a + ws(l).reduce((s, w) => s + (Number(w) || 0), 0), 0);

  // auto batch preview, counting up per PO + fabric like the sheet
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

  async function submit() {
    const bad = d.lines.map((l, i) => {
      if (!l.item && !ws(l).length) return "";
      if (!findFab(p.fabrics, l.item)) return `fabric ${i + 1}: pick the fabric`;
      if (!ws(l).length) return `fabric ${i + 1}: add roll weights`;
      if (ws(l).some((w) => !okW(w))) return `fabric ${i + 1}: a weight is not 0–80 kg`;
      return "";
    }).filter(Boolean);
    if (bad.length) { setErrs([`Fix ${bad.join("; ")}.`]); beep(false); return; }
    setBusy(true); setErrs([]);
    const r = await receivePOAction({ fabricPO: d.fpo, date: d.date, locationId: d.loc, weighedBy: d.wby, challan: d.ch, note: d.note,
      lines: d.lines.map((l) => ({ item: l.item, batch: l.batch, weights: ws(l) })) });
    setBusy(false);
    if (!r.ok) { setErrs([r.error]); beep(false); return; }
    if (!r.data!.ok) { setErrs(r.data!.errors); beep(false); return; }
    beep(true);
    setRes(r.data as Result);
    first.current = true;
    setD({ ...empty, loc: d.loc, wby: d.wby });
  }

  if (res) return (
    <div className="p-4 lg:p-7 flex flex-col gap-4 max-w-4xl">
      <div className="card border-ok bg-okbg p-5">
        <div className="kicker text-ok">PO RECEIVED</div>
        <div className="text-2xl font-semibold mt-1">{res.po} · {res.rolls} rolls · {kg(res.kgG, 2)} kg</div>
        <div className="text-sm mt-1">at {res.location}. Every roll waits in the label queue until its label is scanned — at Rajdanga Storage, the put-away scan does that.</div>
      </div>
      {res.batches.map((b, i) => (
        <div key={i} className="card p-4">
          <div className="flex items-baseline gap-3 flex-wrap"><div className="font-semibold">{b.fabricNo} · {b.fabric} {b.colour}</div>
            <div className="text-sm text-muted">Batch <span className="mono">{b.batch}</span> · {b.serials.length} roll{b.serials.length === 1 ? "" : "s"} · {kg(b.kgG, 2)} kg</div></div>
          <div className="flex gap-2 flex-wrap mt-3">{b.serials.map((s) => <Link key={s} href={`/rolls/${s}`} className="mono text-sm bg-okbg rounded-full px-3 py-1">{s}</Link>)}</div>
        </div>))}
      {msg && <div className="text-sm bg-okbg rounded-md px-3 py-2">{msg}</div>}
      <div className="flex gap-2 flex-wrap">
        {p.isAdmin && <button className="btn-ghost" onClick={async () => {
          window.open(`/api/labels/rolls?serials=${res.batches.flatMap((b) => b.serials).join(",")}`, "_blank");
          setMsg("Labels PDF opened. They stay in the queue until each one is scanned.");
        }}>Print these labels</button>}
        <Link href="/warehouse/put" className="btn-ghost">Put away</Link>
        <button className="btn" onClick={() => setRes(null)}>Receive another PO</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-[calc(100vh-60px)] flex flex-col">
      <div className="p-4 lg:p-7 flex flex-col gap-5 max-w-5xl w-full mx-auto flex-1">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-[260px]"><span className="pill bg-okbg text-ok font-semibold">PO RECEIVING</span>
            <div className="h1 mt-2">Receive a fabric PO</div>
            <div className="sub max-w-xl">Everything that arrived on one fabric PO: each fabric, its batch and every roll weight. Each weight becomes a roll with its own serial and label.</div></div>
          <div className="text-right"><div className="kicker">THIS RECEIPT</div><div className="text-2xl font-semibold">{totalRolls} rolls</div><div className="text-xs text-muted">{totalKg.toFixed(2)} kg · {d.lines.filter((l) => l.item).length} fabrics</div></div>
        </div>
        <section className="card p-5">
          <div className="font-semibold mb-3"><span className="step">1</span>Purchase order</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <F label="Fabric PO *"><input className="input mono uppercase" placeholder="CT26/PO/48 or PO-112" value={d.fpo} onChange={(e) => set({ fpo: e.target.value })} /></F>
            <F label="Date received *"><input className="input" type="date" max={p.today} value={d.date} onChange={(e) => set({ date: e.target.value })} /></F>
            <F label="Received at *"><select className="input" value={d.loc} onChange={(e) => set({ loc: e.target.value })}><option value="">Select location</option>{p.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></F>
            <F label="Weighed by"><input className="input" placeholder="Name" value={d.wby} onChange={(e) => set({ wby: e.target.value })} /></F>
            <F label="Challan / invoice #"><input className="input" placeholder="Optional" value={d.ch} onChange={(e) => set({ ch: e.target.value })} /></F>
            <F label="Note"><input className="input" placeholder="Optional" value={d.note} onChange={(e) => set({ note: e.target.value })} /></F>
          </div>
        </section>
        <section className="card p-5 flex flex-col gap-3">
          <div className="flex items-baseline gap-3 flex-wrap"><div className="font-semibold"><span className="step">2</span>Fabrics and rolls</div>
            <div className="text-xs text-muted">One card per fabric. Type each roll weight and press Enter for the next (or paste several separated by spaces).</div></div>
          <datalist id="fablist">
            {p.fabrics.map((f) => <option key={f.id} value={f.fabricNo}>{`${f.sku ?? ""} · ${f.fabric} ${f.colour}`}</option>)}
            {p.fabrics.filter((f) => f.sku).map((f) => <option key={f.id + "s"} value={f.sku!}>{`${f.fabricNo} · ${f.fabric} ${f.colour}`}</option>)}
          </datalist>
          {d.lines.map((l, i) => {
            const f = findFab(p.fabrics, l.item);
            const weights = l.weights[l.weights.length - 1]?.trim() ? [...l.weights, ""] : l.weights;
            const kgs = ws(l);
            return (
              <div key={i} className="border border-line rounded-xl p-4 focus-within:border-ok">
                <div className="grid grid-cols-[28px_minmax(0,1.3fr)_minmax(0,1fr)_32px] gap-4 items-start">
                  <div className="w-7 h-7 rounded-lg bg-chip text-muted text-xs font-bold grid place-items-center mt-6">{i + 1}</div>
                  <div><label className="label">Fabric</label>
                    <input className="input" list="fablist" placeholder="Fabric # or SKU" value={l.item} onChange={(e) => setLine(i, { item: e.target.value })} />
                    <div className={`text-xs mt-1 ${l.item && !f ? "text-bad" : "text-muted"}`}>{!l.item ? "" : f ? `${f.fabric} · ${f.colour}${f.sku ? "  ·  " + f.sku : ""}` : "Not in Fabric Inventory"}</div></div>
                  <div><label className="label">Batch</label>
                    <input className="input mono uppercase" placeholder={autoBatch[i] ? `Auto: ${autoBatch[i]}` : "Auto (needs PO and fabric)"} value={l.batch} onChange={(e) => setLine(i, { batch: e.target.value })} />
                    <div className="text-xs text-muted mt-1">{l.batch ? "Adding to an existing batch" : "Leave empty for a new batch"}</div></div>
                  <button className="text-faint text-xl mt-6 hover:text-bad" title="Remove fabric" onClick={() => setD((o) => ({ ...o, lines: o.lines.length > 1 ? o.lines.filter((_, j) => j !== i) : [blank()] }))}>×</button>
                </div>
                <label className="label mt-4">Roll weights (kg)</label>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                  {weights.map((w, j) => (
                    <input key={j} data-w={`${i}-${j}`} inputMode="decimal" value={w} placeholder={j === weights.length - 1 ? "+ kg" : "kg"}
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
                  <span><b className="text-ink text-sm">{kgs.reduce((a, w) => a + (Number(w) || 0), 0).toFixed(2)}</b> kg</span>
                  {kgs.some((w) => !okW(w)) && <span className="text-bad">check the red weights (0–80 kg)</span>}</div>
              </div>
            );
          })}
          <button className="self-start h-10 px-4 rounded-lg border border-dashed border-[#c9cfca] text-ok font-semibold hover:bg-okbg" onClick={() => setD((o) => ({ ...o, lines: [...o.lines, blank()] }))}>+ Add another fabric</button>
        </section>
      </div>
      <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-line px-4 lg:px-7 py-3 flex gap-2 items-center flex-wrap">
        <div className="flex-1 min-w-[200px]">{errs.length > 0 && <div className="text-sm bg-badbg text-bad rounded-md px-3 py-2 whitespace-pre-wrap">{errs.join("\n")}</div>}</div>
        <button className="btn-ghost" onClick={async () => { if (!confirm("Clear this receipt?")) return; await discardDraftAction("RECEIVE"); first.current = true; setD(empty); }}>Clear</button>
        <button className="btn h-12 px-6 text-base" disabled={busy} onClick={submit}>{busy ? "Receiving…" : "Receive and create rolls"}</button>
      </div>
    </div>
  );
}
function F({ label, children }: { label: string; children: React.ReactNode }) {
  const req = label.endsWith("*");
  return <div><label className="label">{req ? label.slice(0, -1) : label}{req && <span className="text-bad"> *</span>}</label>{children}</div>;
}
