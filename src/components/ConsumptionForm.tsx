"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { previewTOAction, postTOAction, saveDraftAction, discardDraftAction, rollInfoAction } from "@/app/actions";
import type { RowPlan, Dup } from "@/lib/posting";
import { kg, beep } from "./ScanBox";
import { ScanInput } from "./ScanInput";
import { RollChip } from "./RollLocator";

type Loc = { id: string; name: string };
type Out = { serial: string; fabricNo: string; label: string; kgG: number; forPO: string | null; purpose: string };
type Info = { serial: string; fabricNo: string | null; sku: string | null; item: string; colour: string | null; remainingG: number; invoice: string | null; batch: string; takenOutAt: string | null; takenOutFor: string | null; takenOutPurpose: string | null };
type Row = { serial: string; info: Info | null; err: string | null; kg: string; waste: string; pieces: string; orders: string[] };
type Head = { date: string; src: string; dst: string; po: string; mo: string; inv: string; reason: string };
type Draft = { head: Head; rows: Row[] };
type Done = { to: string; kgG: number; lines: number; pieces: number; pick: RowPlan[]; next: string };

const blank = (): Row => ({ serial: "", info: null, err: null, kg: "", waste: "", pieces: "", orders: [] });
const pcs = (r: Row) => Math.max(0, Math.min(500, parseInt(r.pieces || "0", 10) || 0));

/** TROC: one row per roll that was taken out for production. Scan the roll's barcode, type kg used, waste, pieces and order numbers. */
export function ConsumptionForm(p: { sources: Loc[]; dests: Loc[]; today: string; next: string; draft: Draft | null; defaultDest?: string; defaultSrc?: string; takenOut: Out[] }) {
  const empty: Draft = { head: { date: p.today, src: p.defaultSrc ?? (p.sources.length === 1 ? p.sources[0].id : ""), dst: p.defaultDest ?? "", po: "", mo: "", inv: "", reason: "" }, rows: [blank()] };
  const [d, setD] = useState<Draft>(p.draft?.head ? p.draft : empty);
  const [plan, setPlan] = useState<{ rows: RowPlan[]; errors: string[]; next: string; dups: Dup[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string[]>([]);
  const [done, setDone] = useState<Done | null>(null);
  const [recut, setRecut] = useState<Dup[] | null>(null);
  const h = d.head;
  const setH = (x: Partial<Head>) => setD((o) => ({ ...o, head: { ...o.head, ...x } }));
  const setRow = (i: number, x: Partial<Row>) => setD((o) => ({ ...o, rows: o.rows.map((r, j) => (j === i ? { ...r, ...x } : r)) }));
  const filled = d.rows.filter((r) => r.info);

  const input = useMemo(() => ({
    type: "CONSUMPTION" as const, date: h.date, sourceId: h.src, destinationId: h.dst, stylePO: h.po, mo: h.mo, invoice: h.inv, reason: h.reason,
    lines: d.rows.filter((r) => r.info).map((r) => ({ item: r.info!.fabricNo ?? "", serials: [r.info!.serial], kg: r.kg, waste: r.waste, pieces: pcs(r), orders: r.orders })),
  }), [d, h]);
  useEffect(() => {
    if (!input.lines.length) { setPlan(null); return; }
    const t = setTimeout(async () => { const r = await previewTOAction(input); if (r.ok) setPlan(r.data as never); }, 350);
    return () => clearTimeout(t);
  }, [input]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => saveDraftAction("CONSUMPTION", d), 800);
    return () => clearTimeout(t);
  }, [d]);
  const planFor = (i: number) => plan?.rows[d.rows.slice(0, i + 1).filter((r) => r.info).length - 1];

  async function scanRoll(i: number, code: string) {
    if (d.rows.some((r, j) => j !== i && r.info?.serial === code)) { beep(false); setRow(i, { err: `${code} is already on this TROC.` }); return; }
    const r = await rollInfoAction(code);
    if (!r.ok) { beep(false); setRow(i, { err: r.error, info: null }); return; }
    const x = r.data as Info;
    if (!x.takenOutAt || !["PRODUCTION", "SAMPLING"].includes(x.takenOutPurpose ?? "")) { beep(false); setRow(i, { err: `${x.serial} hasn't been taken out for production. Take it out first (Warehouse → Take out).`, info: null }); return; }
    beep(true);
    setD((o) => {
      const rows = o.rows.map((row, j) => (j === i ? { ...row, serial: x.serial, info: x, err: null } : row));
      if (!rows.some((row) => !row.info)) rows.push(blank());
      return { ...o, head: { ...o.head, po: o.head.po || x.takenOutFor || "" }, rows };
    });
    setTimeout(() => (document.querySelector(`[data-kg="${i}"]`) as HTMLInputElement | null)?.focus(), 0);
  }
  const addOut = (o: Out) => { const i = d.rows.findIndex((r) => !r.info); void scanRoll(i < 0 ? d.rows.length : i, o.serial); if (i < 0) setD((x) => ({ ...x, rows: [...x.rows, blank()] })); };

  async function post(recutChoice?: "recut" | "not-recut") {
    const local = d.rows.map((r, i) => (r.info && pcs(r) && r.orders.filter((o) => o.trim()).length !== pcs(r) ? `row ${i + 1}: order numbers (${r.orders.filter((o) => o.trim()).length} of ${pcs(r)})` : "")).filter(Boolean);
    if (!filled.length) local.unshift("scan at least one roll");
    if (local.length) { setErr([`Fix ${local.join("; ")}.`]); beep(false); return; }
    setBusy(true); setErr([]); setRecut(null);
    const r = await postTOAction({ ...input, recut: recutChoice });
    setBusy(false);
    if (!r.ok) { setErr([r.error]); beep(false); return; }
    const data = r.data!;
    if (!data.ok) { if (data.dups?.length) { setRecut(data.dups); beep(false); return; } setErr(data.errors); beep(false); return; }
    beep(true); setDone(data as Done); first.current = true;
    setD({ ...empty, head: { ...empty.head, src: h.src, dst: h.dst, date: h.date } });
  }

  if (done) return (
    <div className="p-4 lg:p-7 flex flex-col gap-4 max-w-4xl mx-auto">
      <div className="card border-ok bg-okbg p-5">
        <div className="kicker text-ok">POSTED</div><div className="mono text-3xl font-semibold mt-1">{done.to}</div>
        <div className="text-sm mt-1">{kg(done.kgG)} kg from {done.lines} roll{done.lines === 1 ? "" : "s"}{done.pieces ? `, ${done.pieces} pieces with order numbers` : ""}.</div>
        <div className="text-sm mt-2">Rolls with kg left stay “taken out” until they go back on a rack with <Link className="underline" href="/warehouse/put">Put away</Link>. Make the same TO in Zoho or use the <Link className="underline" href={`/zoho?q=${done.to}`}>Zoho prompt</Link>.</div>
      </div>
      <div className="card overflow-x-auto"><table className="tbl"><thead><tr><th>ROLL</th><th>FABRIC</th><th>BATCH</th><th className="text-right">USED</th><th className="text-right">WASTE</th><th className="text-right">LEFT ON ROLL</th></tr></thead>
        <tbody>{done.pick.flatMap((r) => r.takes.map((t) => <tr key={t.serial}><td className="mono font-medium">{t.serial}</td><td>{r.fabric?.fabricNo} · {r.fabric?.label}</td><td className="mono text-xs">{t.batch}</td>
          <td className="text-right font-semibold">{kg(t.kgG)}</td><td className="text-right">{t.wasteG ? kg(t.wasteG) : ""}</td><td className="text-right">{t.rollLeftG > 5 ? kg(t.rollLeftG) : "finished"}</td></tr>))}</tbody></table></div>
      <div className="flex gap-2"><Link className="btn-ghost" href={`/find?q=${done.to}`}>Open {done.to}</Link><button className="btn" onClick={() => setDone(null)}>New TROC ({done.next})</button></div>
    </div>
  );

  const outForPO = p.takenOut.filter((o) => !d.rows.some((r) => r.info?.serial === o.serial) && (!h.po || !o.forPO || o.forPO === h.po.trim().toUpperCase()));
  const totals = d.rows.reduce((a, r) => ({ kg: a.kg + (Number(r.kg) || 0), waste: a.waste + (Number(r.waste) || 0), pieces: a.pieces + pcs(r) }), { kg: 0, waste: 0, pieces: 0 });

  return (
    <div className="min-h-[calc(100vh-60px)] flex flex-col">
      <div className="p-4 lg:p-7 flex flex-col gap-5 max-w-6xl w-full mx-auto flex-1">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-[260px]"><span className="pill font-semibold bg-warnbg text-amber-800">TROC · CONSUMPTION</span>
            <div className="h1 mt-2">New consumption order</div>
            <div className="sub max-w-xl">For fabric that has been cut. Scan each roll that was taken out for this style PO — its invoice and batch come with it — then the kg used, waste, pieces and order numbers.</div></div>
          <div className="text-right"><div className="kicker">ORDER #</div><div className="mono text-2xl font-semibold">{plan?.next ?? p.next}</div><div className="text-xs text-muted">next free number · fixed on post</div></div>
        </div>
        <section className="card p-5">
          <div className="font-semibold mb-3"><span className="step">1</span>Details</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <F label="Date *"><input className="input" type="date" max={p.today} value={h.date} onChange={(e) => setH({ date: e.target.value })} /></F>
            <F label="Style PO *"><ScanInput want="po" mono className="uppercase" placeholder="CT26/PO/88 or PO-112" value={h.po} onChange={(v) => setH({ po: v })} ariaLabel="Style PO" /></F>
            <F label="MO number"><input className="input" placeholder="Optional" value={h.mo} onChange={(e) => setH({ mo: e.target.value })} /></F>
            <F label="From *"><select className="input" value={h.src} onChange={(e) => setH({ src: e.target.value })}><option value="">Select</option>{p.sources.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></F>
            <F label="Production location *"><select className="input" value={h.dst} onChange={(e) => setH({ dst: e.target.value })}><option value="">Select</option>{p.dests.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></F>
            <F label="Tax invoice #"><input className="input" placeholder="Optional" value={h.inv} onChange={(e) => setH({ inv: e.target.value })} /></F>
            <div className="md:col-span-3"><F label="Reason"><input className="input" maxLength={500} placeholder="Optional" value={h.reason} onChange={(e) => setH({ reason: e.target.value })} /></F></div>
          </div>
        </section>
        <section className="card p-5 flex flex-col gap-3">
          <div className="flex items-baseline gap-3 flex-wrap"><div className="font-semibold"><span className="step">2</span>Rolls used</div>
            <div className="text-xs text-muted">One row per roll. Press the barcode button and scan the roll label (or pick it from the rolls taken out below).</div></div>
          {outForPO.length > 0 && (
            <div className="rounded-lg bg-[#faf9f6] border border-line2 p-3">
              <div className="kicker mb-1.5">TAKEN OUT{h.po ? ` FOR ${h.po.toUpperCase()}` : ""} · TAP TO ADD</div>
              <div className="flex flex-wrap gap-1.5">{outForPO.slice(0, 30).map((o) => (
                <button key={o.serial} onClick={() => addOut(o)} className="pill bg-white border border-line hover:border-ink cursor-pointer text-[12px]"><b className="mono">{o.serial}</b> · {o.fabricNo} · {kg(o.kgG, 1)} kg{o.forPO ? ` · ${o.forPO}` : ""}</button>))}</div>
            </div>)}
          <div className="border border-line rounded-xl overflow-hidden">
            {d.rows.map((r, i) => {
              const pl = r.info ? planFor(i) : undefined;
              const n = pcs(r);
              const orders = Array.from({ length: n }, (_, j) => r.orders[j] ?? "");
              const nFilled = orders.filter((o) => o.trim()).length;
              const poDiff = r.info?.takenOutFor && h.po && r.info.takenOutFor !== h.po.trim().toUpperCase();
              return (
                <div key={i} className="p-4 border-b border-line last:border-b-0 flex flex-col gap-3">
                  <div className="grid gap-3 items-start grid-cols-[28px_minmax(0,1.5fr)_100px_90px_80px_28px] max-md:grid-cols-2">
                    <div className="w-7 h-7 rounded-lg bg-chip text-muted text-xs font-bold grid place-items-center mt-1.5 max-md:hidden">{i + 1}</div>
                    <div className="max-md:col-span-2 min-w-0">
                      {r.info ? (
                        <div className="rounded-lg border border-[#b9d9c6] bg-[#fbfefc] px-3 py-2">
                          <div className="flex items-center gap-2 flex-wrap"><RollChip serial={r.info.serial} /><span className="text-sm font-medium">{r.info.fabricNo} · {r.info.item}{r.info.colour ? ` · ${r.info.colour}` : ""}</span>
                            <button className="ml-auto text-xs text-muted underline" onClick={() => setRow(i, { ...blank() })}>change</button></div>
                          <div className="text-[11.5px] text-muted mt-1">Invoice <b className="mono text-ink">{r.info.invoice ?? "—"}</b> · batch <span className="mono">{r.info.batch}</span> · {kg(r.info.remainingG)} kg on the roll · out for {r.info.takenOutPurpose === "SAMPLING" ? "sampling" : r.info.takenOutFor}</div>
                          {poDiff && <div className="text-[11.5px] text-[oklch(0.5_0.12_70)] mt-0.5">Taken out for {r.info.takenOutFor}, this TROC is for {h.po.toUpperCase()}.</div>}
                        </div>
                      ) : (
                        <ScanInput want="serial" value={r.serial} onChange={(v) => setRow(i, { serial: v, err: null })} onScan={(v) => scanRoll(i, v)} placeholder="Scan the roll label" ariaLabel={`Roll ${i + 1}`} mono />
                      )}
                      {r.err && <div className="text-xs text-bad mt-1">{r.err}</div>}
                    </div>
                    <div><input data-kg={i} className="input text-right" type="number" step="0.01" min="0" placeholder="0.00" value={r.kg} onChange={(e) => setRow(i, { kg: e.target.value })} aria-label="Kg used" disabled={!r.info} /><div className="text-[11px] text-muted mt-1 text-right">kg used</div></div>
                    <div><input className="input text-right" type="number" step="0.01" min="0" placeholder="0.00" value={r.waste} onChange={(e) => setRow(i, { waste: e.target.value })} aria-label="Waste kg" disabled={!r.info} /><div className="text-[11px] text-muted mt-1 text-right">waste</div></div>
                    <div><input className="input text-right" type="number" step="1" min="0" placeholder="0" value={r.pieces} onChange={(e) => setRow(i, { pieces: e.target.value })} aria-label="Pieces" disabled={!r.info} /><div className="text-[11px] text-muted mt-1 text-right">pieces</div></div>
                    <button className="text-faint text-xl hover:text-bad mt-1.5" title="Remove row" onClick={() => setD((o) => ({ ...o, rows: o.rows.length > 1 ? o.rows.filter((_, j) => j !== i) : [blank()] }))}>×</button>
                  </div>
                  {pl?.error && <div className="text-sm text-bad md:pl-10">{pl.error}</div>}
                  {r.info && n > 0 && (
                    <div className="md:ml-10 bg-[#f8faf9] border border-dashed border-[#cfd8d2] rounded-xl p-3">
                      <div className="flex items-center gap-3 text-xs font-semibold">Order numbers · {r.info.fabricNo}<span className={nFilled === n ? "text-ok" : "text-muted font-normal"}>{nFilled} of {n} filled</span><span className="flex-1" />
                        <button className="text-ok font-semibold hover:underline" onClick={() => { const v = orders[0]; if (v) setRow(i, { orders: orders.map(() => v) }); }}>Copy piece 1 to all</button></div>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2 mt-2">
                        {orders.map((o, j) => (
                          <input key={j} data-order={`${i}-${j}`} className={`input h-10 text-sm ${o ? "border-[#b9d9c6] bg-[#fbfefc]" : ""} ${plan?.dups.some((x) => x.row === (pl?.row ?? -1) && x.order === o.toUpperCase()) ? "border-warn bg-warnbg" : ""}`} placeholder={`Piece ${j + 1}`} value={o}
                            onChange={(e) => { const nx = [...orders]; nx[j] = e.target.value.trim(); setRow(i, { orders: nx }); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (document.querySelector(`[data-order="${i}-${j + 1}"]`) as HTMLInputElement | null)?.focus(); } }} />))}
                      </div>
                      {plan?.dups.filter((x) => x.row === pl?.row).map((x) => <div key={x.order} className="text-[11.5px] text-[oklch(0.5_0.12_70)] mt-1.5">{x.order} already used {r.info!.fabricNo} on {x.prevTO} — you&apos;ll be asked if it&apos;s a recut.</div>)}
                    </div>)}
                </div>
              );
            })}
            <div className="flex justify-between items-center gap-4 p-3 bg-[#f8faf9] flex-wrap">
              <button className="h-10 px-4 rounded-lg border border-dashed border-[#c9cfca] text-ok font-semibold hover:bg-okbg bg-white" onClick={() => setD((o) => ({ ...o, rows: [...o.rows, blank()] }))}>+ Add roll</button>
              <div className="flex gap-6 text-[11px] text-muted font-semibold"><div>ROLLS<b className="block text-lg text-ink">{filled.length}</b></div><div>KG USED<b className="block text-lg text-ink">{totals.kg.toFixed(2)}</b></div>
                <div>WASTE<b className="block text-lg text-ink">{totals.waste.toFixed(2)}</b></div><div>PIECES<b className="block text-lg text-ink">{totals.pieces}</b></div></div>
            </div>
          </div>
        </section>
      </div>
      {recut && (
        <div className="fixed inset-0 z-[60] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Recut?">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRecut(null)} />
          <div className="relative card p-5 max-w-lg w-full shadow-2xl flex flex-col gap-3">
            <div className="font-semibold text-lg">Is this a recut?</div>
            <div className="text-sm">These order numbers already used the same fabric on an earlier TROC:</div>
            <ul className="text-sm flex flex-col gap-1">{recut.map((x) => <li key={x.row + x.order} className="rounded-md bg-warnbg px-3 py-1.5"><b className="mono">{x.order}</b> · {x.prevTO} → will be saved as <b className="mono">{x.suggestion}</b></li>)}</ul>
            <div className="flex gap-2 justify-end flex-wrap">
              <button className="btn-ghost" onClick={() => setRecut(null)}>Go back</button>
              <button className="btn-ghost" onClick={() => post("not-recut")}>No, keep the numbers</button>
              <button className="btn" onClick={() => post("recut")}>Yes, it&apos;s a recut (add _recut)</button>
            </div>
          </div>
        </div>)}
      <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-line px-4 lg:px-7 py-3 flex gap-2 items-center flex-wrap z-10">
        <div className="flex-1 min-w-[200px]">
          {err.length > 0 ? <div className="text-sm bg-badbg text-bad rounded-md px-3 py-2 whitespace-pre-wrap max-h-24 overflow-auto">{err.join("\n")}</div>
            : plan && plan.errors.length > 0 ? <div className="text-xs text-muted">Still to fix: {plan.errors.slice(0, 3).join(" · ")}</div> : null}
        </div>
        <button className="btn-ghost" onClick={async () => { if (!confirm("Clear this form?")) return; await discardDraftAction("CONSUMPTION"); first.current = true; setD(empty); }}>Clear</button>
        <button className="btn h-12 px-6 text-base" disabled={busy} onClick={() => post()}>{busy ? "Posting…" : "Post consumption"}</button>
      </div>
    </div>
  );
}
function F({ label, children }: { label: string; children: React.ReactNode }) {
  const req = label.endsWith("*");
  return <div className="min-w-0"><label className="label">{req ? label.slice(0, -1) : label}{req && <span className="text-bad"> *</span>}</label>{children}</div>;
}
