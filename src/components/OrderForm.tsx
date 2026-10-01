"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { previewTOAction, postTOAction, planTRORAction, saveDraftAction, discardDraftAction, rollInfoAction } from "@/app/actions";
import type { RowPlan } from "@/lib/posting";
import { ScanBox, kg, beep } from "./ScanBox";
import { ScanInput } from "./ScanInput";
import { RollChip } from "./RollLocator";

type Fab = { id: string; fabricNo: string; sku: string | null; label: string };
type Loc = { id: string; name: string };
type Row = { item: string; kg: string; waste: string; pieces: string; orders: string[]; serials: string[] };
type Head = { date: string; src: string; dst: string; po: string; mo: string; inv: string; reason: string };
type Draft = { head: Head; rows: Row[]; scan: boolean };
type Done = { to: string; kgG: number; lines: number; pieces: number; cuts: { from: string; piece: string; kgG: number }[]; pick: RowPlan[]; next: string };

const blankRow = (): Row => ({ item: "", kg: "", waste: "", pieces: "", orders: [], serials: [] });
const hasContent = (r: Row) => !!(r.item.trim() || Number(r.kg) > 0 || Number(r.waste) > 0 || r.serials.length);
const pcs = (r: Row) => Math.max(0, Math.min(500, parseInt(r.pieces || "0", 10) || 0));

export function OrderForm(p: {
  kind: "TRANSFER" | "CONSUMPTION"; fabrics: Fab[]; sources: Loc[]; dests: Loc[]; today: string; next: string; draft: Draft | null; defaultDest?: string; canPick?: boolean;
}) {
  const C = p.kind === "CONSUMPTION";
  const empty: Draft = {
    head: { date: p.today, src: p.sources.length === 1 ? p.sources[0].id : "", dst: p.defaultDest ?? (p.dests.length === 1 ? p.dests[0].id : ""), po: "", mo: "", inv: "", reason: "" },
    rows: [blankRow()], scan: false,
  };
  const [d, setD] = useState<Draft>(p.draft ?? empty);
  const [plan, setPlan] = useState<{ rows: RowPlan[]; errors: string[]; next: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string[]>([]);
  const [done, setDone] = useState<Done | null>(null);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [planned, setPlanned] = useState<{ id: string; to: string } | null>(null);
  const h = d.head;
  const setH = (x: Partial<Head>) => setD((o) => ({ ...o, head: { ...o.head, ...x } }));
  const setRow = (i: number, x: Partial<Row>) => setD((o) => ({ ...o, rows: o.rows.map((r, j) => (j === i ? { ...r, ...x } : r)) }));

  const input = useMemo(() => ({
    type: p.kind, date: h.date, sourceId: h.src, destinationId: h.dst, stylePO: h.po, mo: h.mo, invoice: h.inv, reason: h.reason,
    lines: d.rows.filter(hasContent).map((r) => ({ item: r.item, kg: r.kg, waste: r.waste, pieces: C ? pcs(r) : 0, orders: C ? r.orders : [], serials: d.scan ? r.serials : [] })),
  }), [d, h, p.kind, C]);

  // live pick list + availability from the server (the same rules as posting)
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await previewTOAction(input);
      if (r.ok) setPlan(r.data as never);
    }, 350);
    return () => clearTimeout(t);
  }, [input]);
  // drafts survive
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => saveDraftAction(p.kind, d), 800);
    return () => clearTimeout(t);
  }, [d, p.kind]);

  const byRow = (i: number) => plan?.rows[d.rows.slice(0, i + 1).filter(hasContent).length - 1];

  async function onScan(code: string) {
    setScanMsg(null);
    if (d.rows.some((r) => r.serials.includes(code))) { beep(false); setScanMsg(`${code} is scanned twice.`); return; }
    const r = await rollInfoAction(code);
    if (!r.ok) { beep(false); setScanMsg(r.error); return; }
    const x = r.data!;
    if (h.src && x.loc !== h.src) { beep(false); setScanMsg(`${code} isn't at the source location.`); return; }
    if (x.status !== "IN_STOCK") { beep(false); setScanMsg(`${code}: ${x.status === "FINISHED" ? "roll is finished" : "label not activated yet"}.`); return; }
    beep(true);
    setD((o) => {
      const rows = [...o.rows];
      let i = rows.findIndex((row) => row.item.trim().toUpperCase() === (x.fabricNo ?? "").toUpperCase());
      if (i < 0) { i = rows.findIndex((row) => !hasContent(row)); if (i < 0) { rows.push(blankRow()); i = rows.length - 1; } rows[i] = { ...rows[i], item: x.fabricNo ?? "" }; }
      rows[i] = { ...rows[i], serials: [...rows[i].serials, x.serial], kg: C ? rows[i].kg : "" };
      return { ...o, rows };
    });
  }

  async function post() {
    const local = d.rows.map((r, i) => {
      if (!hasContent(r)) return "";
      if (C && pcs(r) && r.orders.filter((o) => o.trim()).length !== pcs(r)) return `row ${i + 1}: order numbers (${r.orders.filter((o) => o.trim()).length} of ${pcs(r)})`;
      return "";
    }).filter(Boolean);
    if (local.length) { setErr([`Fix ${local.join("; ")}.`]); beep(false); return; }
    setBusy(true); setErr([]);
    if (!C) {
      const pr = await planTRORAction({ ...input, lines: input.lines.map((l) => ({ item: l.item, kg: l.kg })) });
      setBusy(false);
      if (!pr.ok) { setErr([pr.error]); beep(false); return; }
      if (!pr.data!.ok) { setErr(pr.data!.errors); beep(false); return; }
      beep(true); setPlanned({ id: pr.data!.id, to: pr.data!.to }); first.current = true;
      setD({ ...empty, head: { ...empty.head, src: h.src, dst: h.dst, date: h.date } });
      return;
    }
    const r = await postTOAction(input);
    setBusy(false);
    if (!r.ok) { setErr([r.error]); beep(false); return; }
    if (!r.data!.ok) { setErr(r.data!.errors); beep(false); return; }
    beep(true);
    setDone(r.data as Done);
    first.current = true;
    setD({ ...empty, head: { ...empty.head, src: h.src, dst: h.dst, date: h.date } });
  }

  if (done) return <DoneView d={done} C={C} onAgain={() => setDone(null)} />;
  if (planned) return (
    <div className="p-4 lg:p-7 flex flex-col gap-4 max-w-3xl mx-auto">
      <div className="card border-ok bg-okbg p-5">
        <div className="kicker text-ok">TROR CREATED · WAITING FOR THE WAREHOUSE</div>
        <div className="mono text-3xl font-semibold mt-1">{planned.to}</div>
        <div className="text-sm mt-2">Send the PDF to the warehouse. They scan its barcode on <b>Pick a TROR</b>, scan each roll as it comes off the rack (any batch of the right fabric), and press Dispatch. Stock moves then — nobody posts it twice.</div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <a className="btn" href={`/api/to/${planned.id}/pdf`} target="_blank" rel="noreferrer">Open the PDF</a>
        {p.canPick && <Link className="btn-ghost" href={`/to/pick/${planned.id}`}>Pick it now</Link>}
        <Link className="btn-ghost" href="/to/pick">Open TRORs</Link>
        <button className="btn-ghost" onClick={() => setPlanned(null)}>New TROR</button>
      </div>
    </div>
  );

  const totals = d.rows.reduce((a, r, i) => { const pl = byRow(i); return { kg: a.kg + (pl?.needG ?? 0), waste: a.waste + (C ? pl?.wasteG ?? 0 : 0), pieces: a.pieces + (C ? pcs(r) : 0), items: a.items + (r.item ? 1 : 0) }; }, { kg: 0, waste: 0, pieces: 0, items: 0 });
  const src = p.sources.find((l) => l.id === h.src), dst = p.dests.find((l) => l.id === h.dst);

  return (
    <div className="min-h-[calc(100vh-60px)] flex flex-col">
      <datalist id="fablist">
        {p.fabrics.map((f) => <option key={f.id} value={f.fabricNo}>{`${f.sku ?? ""} · ${f.label}`}</option>)}
        {p.fabrics.filter((f) => f.sku).map((f) => <option key={f.id + "s"} value={f.sku!}>{`${f.fabricNo} · ${f.label}`}</option>)}
      </datalist>
      <div className="p-4 lg:p-7 flex flex-col gap-5 max-w-6xl w-full mx-auto flex-1">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <span className={`pill font-semibold ${C ? "bg-warnbg text-amber-800" : "bg-okbg text-ok"}`}>{C ? "TROC · CONSUMPTION" : "TROR · TRANSFER OF ROLLS"}</span>
            <div className="h1 mt-2">{C ? "New consumption order" : "New transfer order"}</div>
            <div className="sub max-w-xl">{C ? "Fabric used for a style order. Post it once the fabric has been cut." : "Make the TROR here and send the PDF. The warehouse scans the rolls against it and dispatches — stock moves then, once."}</div>
          </div>
          <div className="text-right"><div className="kicker">ORDER #</div><div className="mono text-2xl font-semibold">{plan?.next ?? p.next}</div><div className="text-xs text-muted">next free number · {C ? "fixed on post" : "given when you create it"}</div></div>
        </div>

        <section className="card p-5">
          <div className="font-semibold mb-3"><span className="step">1</span>Details</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <F label="Date *"><input className="input" type="date" max={p.today} value={h.date} onChange={(e) => setH({ date: e.target.value })} /></F>
            {C && <F label="Style PO *"><input className="input mono uppercase" placeholder="CT26/PO/88 or PO-112" value={h.po} onChange={(e) => setH({ po: e.target.value })} /></F>}
            <F label="MO number"><input className="input" placeholder="Optional" value={h.mo} onChange={(e) => setH({ mo: e.target.value })} /></F>
            <F label="Tax invoice #"><input className="input" placeholder="Optional" value={h.inv} onChange={(e) => setH({ inv: e.target.value })} /></F>
            <div className={C ? "md:col-span-2" : "md:col-span-3"}><F label="Reason"><textarea className="input h-auto py-2" rows={2} maxLength={500} placeholder="What is this for? (max 500 characters)" value={h.reason} onChange={(e) => setH({ reason: e.target.value })} /></F></div>
          </div>
        </section>

        <section className="card p-5">
          <div className="flex items-baseline gap-3 flex-wrap mb-3"><div className="font-semibold"><span className="step">2</span>Route</div>
            <div className="text-xs text-muted">{C ? "Consumption goes to a production location: that fabric becomes cloth and leaves stock." : "Transfers are between stock locations. Fabric going to production is a consumption order."}</div></div>
          <div className="grid grid-cols-[minmax(0,1fr)_44px_minmax(0,1fr)] gap-3 items-end">
            <F label="Source location *"><select className="input" value={h.src} onChange={(e) => setD((o) => ({ ...o, head: { ...o.head, src: e.target.value }, rows: o.scan ? o.rows.map((r) => ({ ...r, serials: [] })) : o.rows }))}>
              <option value="">Select location</option>{p.sources.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></F>
            <div className="w-10 h-10 rounded-xl grid place-items-center bg-okbg text-ok font-bold mx-auto">→</div>
            <F label="Destination location *"><select className="input" value={h.dst} onChange={(e) => setH({ dst: e.target.value })}>
              <option value="">Select location</option>{p.dests.filter((l) => l.id !== h.src).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></F>
          </div>
        </section>

        <section className="card p-5 flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="font-semibold"><span className="step">3</span>Items</div>
            <div className="text-xs text-muted flex-1">{d.scan ? "Scan the rolls that actually went. They are grouped by fabric." : C ? "Type a Fabric # or SKU. Kg is taken from the oldest rolls first. Pieces are optional, per row." : "Scan the SKU barcode or type the Fabric #, and the kg. The warehouse may send any batch of that fabric; the oldest rolls are suggested."}</div>
            {C && <div className="flex bg-[#e7e4dd] rounded-lg p-[3px] text-[13px]">
              <button onClick={() => setD((o) => ({ ...o, scan: false, rows: o.rows.map((r) => ({ ...r, serials: [] })) }))} className={`px-3 py-1.5 rounded-md ${!d.scan ? "bg-white font-semibold" : ""}`}>Oldest first</button>
              <button onClick={() => setD((o) => ({ ...o, scan: true }))} className={`px-3 py-1.5 rounded-md ${d.scan ? "bg-white font-semibold" : ""}`}>Scan rolls</button>
            </div>}
          </div>
          {d.scan && <>
            <ScanBox onScan={onScan} keepFocus={false} placeholder={src ? `Scan rolls from ${src.name}…` : "Pick the source first, then scan…"} disabled={!h.src} />
            {scanMsg && <div className="text-sm bg-badbg text-bad rounded-md px-3 py-2">{scanMsg}</div>}
          </>}
          <div className="border border-line rounded-xl overflow-hidden">
            {d.rows.map((r, i) => {
              const pl = hasContent(r) ? byRow(i) : undefined;
              const n = pcs(r);
              const orders = Array.from({ length: n }, (_, j) => r.orders[j] ?? "");
              const filled = orders.filter((o) => o.trim()).length;
              return (
                <div key={i} className="p-4 border-b border-line last:border-b-0 flex flex-col gap-3 hover:bg-[#fbfcfb]">
                  <div className={`grid gap-3 items-start ${C ? "grid-cols-[28px_minmax(0,1.3fr)_minmax(0,1.2fr)_100px_90px_80px_28px]" : "grid-cols-[28px_minmax(0,1.4fr)_minmax(0,1.4fr)_150px_28px]"} max-md:grid-cols-2`}>
                    <div className="w-7 h-7 rounded-lg bg-chip text-muted text-xs font-bold grid place-items-center mt-1.5 max-md:hidden">{i + 1}</div>
                    <div className="max-md:col-span-2">
                      <ScanInput want="sku" list="fablist" placeholder="Scan SKU or type Fabric #" value={r.item} onChange={(v) => setRow(i, { item: v, serials: [] })} ariaLabel={`Item ${i + 1}`} />
                      <div className={`text-xs mt-1 ${pl?.fabric || !r.item ? "text-muted" : "text-bad"}`}>{!r.item ? "" : pl?.fabric ? `${pl.fabric.label}${pl.fabric.sku ? "  ·  " + pl.fabric.sku : ""}` : "Not in Fabric Inventory"}</div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-md:col-span-2">
                      {!pl?.fabric ? <span className="text-xs text-faint pt-2.5">Stock shows here once you pick an item</span> : <>
                        <span className="pill bg-okbg text-ok">From <b>{kg(pl.haveG, 1)} kg</b></span>
                        {pl.waitingG > 0 && <span className="pill bg-warnbg">+{kg(pl.waitingG, 1)} kg awaiting label</span>}
                        {pl.destG !== null && dst && <span className="pill bg-[#eaf1fb] text-[#2459a8]">At {dst.name} <b>{kg(pl.destG, 1)} kg</b></span>}
                        {pl.haveG > 0 && pl.needG > 0 && <div className="w-full h-1.5 bg-line2 rounded mt-1"><div className={`h-full rounded ${pl.needG + pl.wasteG > pl.haveG ? "bg-bad" : "bg-ok"}`} style={{ width: `${Math.min(100, ((pl.needG + pl.wasteG) / pl.haveG) * 100)}%` }} /></div>}
                      </>}
                    </div>
                    <div><input className="input text-right" type="number" step="0.01" min="0" placeholder={d.scan && !C ? "auto" : "0.00"} value={r.kg} onChange={(e) => setRow(i, { kg: e.target.value })} aria-label={C ? "Kg used" : "Quantity kg"} />
                      <div className="text-[11px] text-muted mt-1 text-right">{C ? "kg used" : "kg"}</div></div>
                    {C && <div><input className="input text-right" type="number" step="0.01" min="0" placeholder="0.00" value={r.waste} onChange={(e) => setRow(i, { waste: e.target.value })} aria-label="Waste kg" /><div className="text-[11px] text-muted mt-1 text-right">waste</div></div>}
                    {C && <div><input className="input text-right" type="number" step="1" min="0" placeholder="0" value={r.pieces} onChange={(e) => setRow(i, { pieces: e.target.value })} aria-label="Pieces" /><div className="text-[11px] text-muted mt-1 text-right">pieces</div></div>}
                    <button className="text-faint text-xl hover:text-bad mt-1.5" title="Remove row" onClick={() => setD((o) => ({ ...o, rows: o.rows.length > 1 ? o.rows.filter((_, j) => j !== i) : [blankRow()] }))}>×</button>
                  </div>
                  {d.scan && r.serials.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 md:pl-10">{r.serials.map((s) => (
                      <span key={s} className="pill bg-chip mono">{s} <button className="ml-1 text-faint hover:text-bad" onClick={() => setRow(i, { serials: r.serials.filter((x) => x !== s) })}>×</button></span>))}</div>
                  )}
                  {pl?.error && <div className="text-sm text-bad md:pl-10">{pl.error}</div>}
                  {pl && !pl.error && pl.takes.length > 0 && (
                    <div className="md:pl-10">
                      <div className="kicker mb-1">{C ? "PICK LIST" : "SUGGESTED ROLLS · OLDEST FIRST · CLICK TO SEE WHERE"}</div>
                      <div className="flex flex-wrap gap-1.5">{pl.takes.map((t) => (
                        <RollChip key={t.serial} serial={t.serial} className={t.cut ? "bg-warnbg" : ""}>
                          <b className="mono">{t.serial}</b>{t.rack ? <> · <span className="mono">{t.rack}</span></> : ""} · {kg(t.kgG + t.wasteG, 2)} kg{t.cut ? ` · cut, ${kg(t.rollLeftG, 2)} kg stays` : !C ? " · whole roll" : t.rollLeftG > 5 ? ` · ${kg(t.rollLeftG, 2)} kg left` : " · finishes the roll"}
                        </RollChip>))}</div>
                    </div>
                  )}
                  {C && n > 0 && (
                    <div className="md:ml-10 bg-[#f8faf9] border border-dashed border-[#cfd8d2] rounded-xl p-3">
                      <div className="flex items-center gap-3 text-xs font-semibold">Order numbers{pl?.fabric ? ` · ${pl.fabric.label}` : ""}
                        <span className={filled === n ? "text-ok" : "text-muted font-normal"}>{filled} of {n} filled</span><span className="flex-1" />
                        <button className="text-ok font-semibold hover:underline" onClick={() => { const v = orders[0]; if (!v) return; setRow(i, { orders: orders.map(() => v) }); }}>Copy piece 1 to all</button></div>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2 mt-2">
                        {orders.map((o, j) => (
                          <input key={j} data-order={`${i}-${j}`} className={`input h-10 text-sm ${o ? "border-[#b9d9c6] bg-[#fbfefc]" : ""}`} placeholder={`Piece ${j + 1}`} value={o}
                            onChange={(e) => { const next = [...orders]; next[j] = e.target.value.trim(); setRow(i, { orders: next }); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (document.querySelector(`[data-order="${i}-${j + 1}"]`) as HTMLInputElement | null)?.focus(); } }} />))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="flex justify-between items-center gap-4 p-3 bg-[#f8faf9] flex-wrap">
              <button className="h-10 px-4 rounded-lg border border-dashed border-[#c9cfca] text-ok font-semibold hover:bg-okbg bg-white" onClick={() => setD((o) => ({ ...o, rows: [...o.rows, blankRow()] }))}>+ Add row</button>
              <div className="flex gap-6 text-[11px] text-muted font-semibold">
                <div>ITEMS<b className="block text-lg text-ink">{totals.items}</b></div>
                {C && <><div>KG USED<b className="block text-lg text-ink">{kg(totals.kg)}</b></div><div>WASTE<b className="block text-lg text-ink">{kg(totals.waste)}</b></div><div>PIECES<b className="block text-lg text-ink">{totals.pieces}</b></div></>}
                <div>TOTAL KG<b className="block text-lg text-ink">{kg(totals.kg + totals.waste)}</b></div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-line px-4 lg:px-7 py-3 flex gap-2 items-center flex-wrap z-10">
        <div className="flex-1 min-w-[200px]">
          {err.length > 0 ? <div className="text-sm bg-badbg text-bad rounded-md px-3 py-2 whitespace-pre-wrap max-h-24 overflow-auto">{err.join("\n")}</div>
            : plan && plan.errors.length > 0 && d.rows.some(hasContent) ? <div className="text-xs text-muted">Still to fix: {plan.errors.slice(0, 3).join(" · ")}</div> : null}
        </div>
        <button className="btn-ghost" onClick={async () => { if (!confirm("Clear this form?")) return; await discardDraftAction(p.kind); first.current = true; setD(empty); }}>Clear</button>
        <button className="btn h-12 px-6 text-base" disabled={busy} onClick={post}>{busy ? (C ? "Posting…" : "Creating…") : C ? "Post consumption" : "Create TROR"}</button>
      </div>
    </div>
  );
}

function DoneView({ d, C, onAgain }: { d: Done; C: boolean; onAgain: () => void }) {
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-4 max-w-5xl mx-auto">
      <div className="card border-ok bg-okbg p-5">
        <div className="kicker text-ok">POSTED</div>
        <div className="mono text-3xl font-semibold mt-1">{d.to}</div>
        <div className="text-sm mt-1">{kg(d.kgG)} kg from {d.lines} roll line{d.lines === 1 ? "" : "s"}{d.pieces ? `, ${d.pieces} pieces with order numbers` : ""}.</div>
        <div className="text-sm mt-2 font-medium">Now make the same TO in Zoho with number {d.to}, then tick “Entered in Zoho” in the TO Log — or let Claude do it from the <Link className="underline" href={`/zoho?q=${d.to}`}>Zoho prompt</Link>.</div>
        {d.cuts.length > 0 && <div className="text-sm mt-2">{d.cuts.length} cut piece{d.cuts.length === 1 ? "" : "s"} got a new serial and label: {d.cuts.map((c) => `${c.piece} (${kg(c.kgG)} kg from ${c.from})`).join(", ")}. <Link className="underline" href="/labels">Print labels</Link>.</div>}
      </div>
      <div className="card overflow-x-auto">
        <div className="px-4 py-3 border-b border-line font-semibold">Pick list</div>
        <table className="tbl"><thead><tr><th>ROW</th><th>FABRIC</th><th>ROLL</th><th>RACK</th><th>BATCH</th><th className="text-right">KG</th>{C && <th className="text-right">WASTE</th>}<th>NOTE</th></tr></thead>
          <tbody>{d.pick.flatMap((r) => r.takes.map((t) => (
            <tr key={r.row + t.serial}><td>{r.row}</td><td>{r.fabric?.fabricNo} · {r.fabric?.label}</td><td className="mono font-medium">{t.serial}</td><td className="mono">{t.rack ?? "—"}</td>
              <td className="mono text-xs">{t.batch}</td><td className="text-right font-semibold">{kg(t.kgG)}</td>{C && <td className="text-right">{t.wasteG ? kg(t.wasteG) : ""}</td>}
              <td className="text-muted text-xs">{t.cut ? `cut — ${kg(t.rollLeftG)} kg stays on the roll` : C ? (t.rollLeftG > 5 ? `${kg(t.rollLeftG)} kg left` : "roll finished") : "whole roll"}</td></tr>)))}</tbody></table>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button className="btn-ghost" onClick={() => window.print()}>Print pick list</button>
        <Link className="btn-ghost" href={`/find?q=${d.to}`}>Open {d.to}</Link>
        <button className="btn" onClick={onAgain}>New order ({d.next})</button>
      </div>
    </div>
  );
}
function F({ label, children }: { label: string; children: React.ReactNode }) {
  const req = label.endsWith("*");
  return <div><label className="label">{req ? label.slice(0, -1) : label}{req && <span className="text-bad"> *</span>}</label>{children}</div>;
}
