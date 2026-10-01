"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { pickAction, unpickAction, dispatchAction, cancelTRORAction, trorViewAction } from "@/app/actions";
import { ScanBox, beep, kg } from "./ScanBox";
import { RollChip } from "./RollLocator";

type View = {
  id: string; to: string; status: string; date: string; from: string; to_: string; reason: string | null; plannedBy: string | null;
  rows: { row: number; fabricNo: string | null; sku: string | null; label: string; needG: number; pickedG: number; leftG: number;
    picks: { serial: string; kgG: number; rollG: number; cut: boolean; batch: string; invoice: string | null; by: string }[];
    suggestions: { serial: string; kgG: number; rack: string | null; room: string | null; received: string; batch: string }[] }[];
};

/** Open TRORs: scan the TROR barcode from the PDF (or click one) to start picking. */
export function TRORList({ open }: { open: { id: string; to_number: string; src: string; dst: string; need_g: number; picked_g: number; rolls: number; planned_by: string; date: string }[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5 flex flex-col gap-2">
        <div className="font-semibold">Scan the TROR barcode on the PDF</div>
        <ScanBox keepFocus={false} placeholder="Scan TROR-… or type its number" onScan={async (c) => {
          setErr(null);
          const r = await trorViewAction(c);
          if (!r.ok) { beep(false); setErr(r.error); return; }
          if (r.data!.status !== "PLANNED") { beep(false); setErr(`${r.data!.to} is ${r.data!.status === "POSTED" ? "already dispatched" : "cancelled"}.`); return; }
          beep(true); router.push(`/to/pick/${r.data!.id}`);
        }} />
        {err && <div className="text-sm bg-badbg text-bad rounded-md px-3 py-2">{err}</div>}
      </section>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {open.map((t) => {
          const pct = t.need_g ? Math.min(100, Math.round((t.picked_g / t.need_g) * 100)) : 0;
          return (
            <Link key={t.id} href={`/to/pick/${t.id}`} className="card p-4 flex flex-col gap-2 hover:border-ink hover:text-ink">
              <div className="flex items-baseline gap-2"><span className="mono text-lg font-semibold">{t.to_number}</span><span className="text-xs text-muted ml-auto">{t.date}</span></div>
              <div className="text-sm">{t.src} → <b>{t.dst}</b></div>
              <div className="h-1.5 rounded bg-line2"><div className="h-full rounded bg-ok" style={{ width: `${pct}%` }} /></div>
              <div className="text-xs text-muted">{kg(t.picked_g, 1)} of {kg(t.need_g, 1)} kg picked · {t.rolls} roll{t.rolls === 1 ? "" : "s"} · made by {String(t.planned_by ?? "").split("@")[0]}</div>
            </Link>);
        })}
        {!open.length && <div className="card p-6 text-sm text-muted">No TRORs waiting. They appear here when the office creates one.</div>}
      </div>
    </div>
  );
}

export function PickTROR({ initial }: { initial: View }) {
  const router = useRouter();
  const [v, setV] = useState<View>(initial);
  const [cards, setCards] = useState<{ ok: boolean; msg: string }[]>([]);
  const [cut, setCut] = useState<{ serial: string; rollG: number; needG: number; kg: string } | null>(null);
  const [short, setShort] = useState<{ list: string[]; reason: string } | null>(null);
  const [done, setDone] = useState<{ to: string; cuts: { from: string; piece: string; kgG: number }[]; kgG: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => { const r = await trorViewAction(v.id); if (r.ok) setV(r.data as View); };
  const note = (ok: boolean, msg: string) => { beep(ok); setCards((c) => [{ ok, msg }, ...c].slice(0, 8)); };

  async function scan(code: string, opt: { cutKg?: string; whole?: boolean } = {}) {
    const r = await pickAction(v.id, code, opt);
    if (!r.ok) { note(false, r.error); return; }
    const d = r.data!;
    if (d.kind === "cut") { beep(false); setCut({ serial: d.serial, rollG: d.rollG, needG: d.needG, kg: (d.needG / 1000).toFixed(2) }); return; }
    note(d.kind === "ok", d.msg);
    if (d.kind === "ok") await refresh();
  }
  async function dispatch(shortReason?: string) {
    setBusy(true);
    const r = await dispatchAction(v.id, { shortReason });
    setBusy(false);
    if (!r.ok) { note(false, r.error); return; }
    const d = r.data!;
    if (!d.ok) { if ("short" in d && d.short) { setShort({ list: d.errors, reason: "" }); beep(false); return; } note(false, d.errors.join(" ")); return; }
    beep(true); setDone({ to: d.to, cuts: d.cuts, kgG: d.kgG }); router.refresh();
  }

  if (done) return (
    <div className="card border-ok bg-okbg p-5 flex flex-col gap-2">
      <div className="kicker text-ok">DISPATCHED</div><div className="mono text-3xl font-semibold">{done.to}</div>
      <div className="text-sm">{kg(done.kgG)} kg moved from {v.from} to {v.to_}. Racks are updated; the rolls show at {v.to_}.</div>
      {done.cuts.length > 0 && <div className="text-sm">Cut pieces got new serials: {done.cuts.map((c) => `${c.piece} (${kg(c.kgG)} kg from ${c.from})`).join(", ")}. The rest of each cut roll stays here — put it back with <Link className="underline" href="/warehouse/put">Put away</Link>{" "}and print the new labels on <Link className="underline" href="/labels">Labels</Link>.</div>}
      <div className="flex gap-2 mt-2"><Link className="btn-ghost" href={`/find?q=${done.to}`}>Open {done.to}</Link><Link className="btn" href="/to/pick">Next TROR</Link></div>
    </div>
  );

  const totalNeed = v.rows.reduce((a, r) => a + r.needG, 0), totalPicked = v.rows.reduce((a, r) => a + r.pickedG, 0);
  const complete = v.rows.every((r) => r.leftG <= 50);
  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5 flex items-center gap-4 flex-wrap">
        <div><div className="kicker">PICKING</div><div className="mono text-3xl font-semibold">{v.to}</div><div className="text-sm">{v.from} → <b>{v.to_}</b>{v.reason ? ` · ${v.reason}` : ""}</div></div>
        <div className="ml-auto text-right"><div className="text-2xl font-semibold">{kg(totalPicked, 1)} / {kg(totalNeed, 1)} kg</div><div className="text-xs text-muted">made by {v.plannedBy?.split("@")[0]} · {v.date}</div></div>
        <div className="w-full flex gap-2 flex-wrap">
          <a className="btn-ghost btn-sm" href={`/api/to/${v.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>
          <button className="btn-ghost btn-sm" onClick={async () => { const reason = prompt(`Cancel ${v.to} — reason?`); if (!reason) return; const r = await cancelTRORAction(v.id, reason); if (r.ok) router.push("/to/pick"); else note(false, r.error); }}>Cancel TROR</button>
        </div>
      </section>
      <section className="card p-5 flex flex-col gap-3">
        <div className="font-semibold">Scan each roll as it comes off the rack</div>
        <ScanBox onScan={(c) => scan(c)} keepFocus={false} placeholder="Scan a roll label…" />
        {cards.map((c, i) => <div key={i} className={`rounded-lg px-4 py-2.5 text-sm ${c.ok ? "bg-okbg" : "bg-badbg text-bad"}`}>{c.msg}</div>)}
      </section>
      {v.rows.map((r) => {
        const pct = Math.min(100, (r.pickedG / Math.max(1, r.needG)) * 100);
        return (
          <section key={r.row} className={`card p-5 flex flex-col gap-3 ${r.leftG <= 50 ? "border-ok" : ""}`}>
            <div className="flex items-baseline gap-3 flex-wrap"><span className="w-7 h-7 rounded-lg bg-chip text-xs font-bold grid place-items-center">{r.row}</span>
              <div className="font-semibold">{r.fabricNo} · {r.label}</div>{r.sku && <span className="mono text-xs text-muted">{r.sku}</span>}
              <div className="ml-auto text-sm"><b>{kg(r.pickedG)}</b> of {kg(r.needG)} kg {r.leftG <= 50 ? <span className="text-ok font-semibold">✓ done</span> : <span className="text-muted">· {kg(r.leftG)} to go</span>}</div></div>
            <div className="h-2 rounded bg-line2"><div className={`h-full rounded ${pct >= 99 ? "bg-ok" : "bg-[oklch(0.6_0.12_160)]"}`} style={{ width: `${pct}%` }} /></div>
            {r.picks.length > 0 && <div className="flex flex-wrap gap-1.5">{r.picks.map((p) => (
              <span key={p.serial} className={`inline-flex items-center gap-1 rounded-full pl-1 pr-2 py-0.5 text-[12px] ${p.cut ? "bg-warnbg" : "bg-okbg"}`}>
                <RollChip serial={p.serial} className="border-0 bg-transparent" /><span>{p.cut ? `cut ${kg(p.kgG)} of ${kg(p.rollG)}` : kg(p.kgG)} kg · {p.batch}</span>
                <button className="ml-1 text-faint hover:text-bad" title="Remove from TROR" onClick={async () => { const x = await unpickAction(v.id, p.serial); if (x.ok) { note(true, `${p.serial} removed — put it back on its rack.`); await refresh(); } else note(false, x.error); }}>×</button>
              </span>))}</div>}
            {r.leftG > 50 && r.suggestions.length > 0 && (
              <div><div className="kicker mb-1">OLDEST ROLLS · ANY BATCH IS FINE · CLICK TO SEE WHERE</div>
                <div className="flex flex-wrap gap-1.5">{r.suggestions.filter((s) => !r.picks.some((p) => p.serial === s.serial)).slice(0, 8).map((s) => (
                  <RollChip key={s.serial} serial={s.serial}><b className="mono">{s.serial}</b> · {s.rack ? <><b className="mono">{s.rack}</b> {s.room}</> : "off rack"} · {kg(s.kgG, 1)} kg</RollChip>))}</div></div>)}
          </section>);
      })}
      <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-line -mx-4 lg:-mx-7 px-4 lg:px-7 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex-1 text-sm text-muted">{complete ? "Everything is picked. Dispatch moves the stock now." : "Dispatch when every row is picked (or dispatch short with a reason)."}</div>
        <button className="btn h-12 px-6 text-base" disabled={busy || totalPicked === 0} onClick={() => dispatch()}>{busy ? "Dispatching…" : `Dispatch ${v.to}`}</button>
      </div>
      {cut && (
        <div className="fixed inset-0 z-[60] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Cut this roll?">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCut(null)} />
          <div className="relative card p-5 max-w-md w-full shadow-2xl flex flex-col gap-3">
            <div className="font-semibold text-lg">{cut.serial} is more than needed</div>
            <div className="text-sm">The roll has {kg(cut.rollG)} kg; this row needs {kg(cut.needG)} kg. Cut it (the piece gets a new serial and label at dispatch), or send the whole roll.</div>
            <label className="label">Kg to send (cut)</label><input className="input text-right text-lg" autoFocus inputMode="decimal" value={cut.kg} onChange={(e) => setCut({ ...cut, kg: e.target.value })} />
            <div className="flex gap-2 justify-end"><button className="btn-ghost" onClick={() => setCut(null)}>Back</button>
              <button className="btn-ghost" onClick={() => { const s = cut.serial; setCut(null); void scan(s, { whole: true }); }}>Send whole roll</button>
              <button className="btn" onClick={() => { const s = cut.serial, k = cut.kg; setCut(null); void scan(s, { cutKg: k }); }}>Cut {cut.kg} kg</button></div>
          </div>
        </div>)}
      {short && (
        <div className="fixed inset-0 z-[60] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Dispatch short?">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShort(null)} />
          <div className="relative card p-5 max-w-md w-full shadow-2xl flex flex-col gap-3">
            <div className="font-semibold text-lg">Not everything is picked</div>
            <ul className="text-sm list-disc pl-5">{short.list.map((x) => <li key={x}>{x}</li>)}</ul>
            <label className="label">Why dispatch short?</label><input className="input" autoFocus value={short.reason} onChange={(e) => setShort({ ...short, reason: e.target.value })} placeholder="e.g. not enough on the racks" />
            <div className="flex gap-2 justify-end"><button className="btn-ghost" onClick={() => setShort(null)}>Keep picking</button>
              <button className="btn" disabled={!short.reason.trim()} onClick={() => { const rsn = short.reason; setShort(null); void dispatch(rsn); }}>Dispatch short</button></div>
          </div>
        </div>)}
    </div>
  );
}
