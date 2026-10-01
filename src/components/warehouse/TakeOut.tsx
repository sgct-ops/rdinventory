"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { takeOutAction, fifoAction } from "@/app/actions";
import { ScanBox, beep, kg } from "../ScanBox";
import { ScanInput } from "../ScanInput";
import { RollChip } from "../RollLocator";

type Fifo = { fabric: { id: string; fabricNo: string | null; sku: string | null; label: string } | null; totalG: number;
  rolls: { serial: string; kgG: number; received: string; rack: string | null; room: string | null; building: string | null; batch: string; invoice: string | null; ageDays: number }[] };
type Card = { ok: boolean; msg: string; serial: string };

/** Take rolls off the racks for production or sampling, before the TROC. Oldest roll first. */
export function TakeOut() {
  const router = useRouter();
  const [purpose, setPurpose] = useState<"PRODUCTION" | "SAMPLING">("PRODUCTION");
  const [po, setPo] = useState("");
  const [fab, setFab] = useState("");
  const [fifo, setFifo] = useState<Fifo | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [confirm, setConfirm] = useState<{ serial: string; msg: string; oldest: { serial: string; rack: string | null } } | null>(null);
  const loadFifo = async (f: string) => { if (!f.trim()) { setFifo(null); return; } const r = await fifoAction(f); if (r.ok) setFifo(r.data as Fifo); };
  useEffect(() => { const t = setTimeout(() => loadFifo(fab), 300); return () => clearTimeout(t); }, [fab]);

  async function go(code: string, confirmNotOldest = false) {
    if (purpose === "PRODUCTION" && !po.trim()) { beep(false); setCards((c) => [{ ok: false, serial: code, msg: "Type or scan the style PO first." }, ...c]); return; }
    const r = await takeOutAction({ code, purpose, forPO: po, fabric: fab || undefined, confirmNotOldest });
    if (!r.ok) { beep(false); setCards((c) => [{ ok: false, serial: code, msg: r.error }, ...c]); return; }
    const d = r.data!;
    if (d.kind === "confirm") { beep(false); setConfirm({ serial: d.serial, msg: d.msg, oldest: d.oldest }); return; }
    beep(d.kind === "ok");
    setCards((c) => [{ ok: d.kind === "ok", serial: d.serial, msg: d.msg }, ...c]);
    if (d.kind === "ok") { void loadFifo(fab); router.refresh(); }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5 grid gap-4 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-end">
        <div><label className="label">Taken out for</label>
          <div className="flex bg-[#e7e4dd] rounded-lg p-[3px] text-[13px] h-11 items-stretch">
            {(["PRODUCTION", "SAMPLING"] as const).map((x) => <button key={x} onClick={() => setPurpose(x)} className={`px-4 rounded-md cursor-pointer ${purpose === x ? "bg-white font-semibold" : ""}`}>{x === "PRODUCTION" ? "Production" : "Sampling"}</button>)}
          </div></div>
        <div><label className="label">Style PO {purpose === "PRODUCTION" ? <span className="text-bad">*</span> : "(optional)"}</label>
          <ScanInput want="po" mono className="uppercase" value={po} onChange={setPo} placeholder="CT26/PO/88" ariaLabel="Style PO" /></div>
        <div><label className="label">Which fabric? (shows the oldest rolls first)</label>
          <ScanInput want="sku" value={fab} onChange={setFab} placeholder="Scan the SKU barcode or type Fabric #" ariaLabel="Fabric to take out" /></div>
      </section>

      {fifo && (
        <section className="card p-5 flex flex-col gap-3">
          {!fifo.fabric ? <div className="text-sm text-bad">No fabric &quot;{fab}&quot; in Fabric Inventory.</div> : <>
            <div className="flex items-baseline gap-3 flex-wrap"><div className="font-semibold">{fifo.fabric.fabricNo} · {fifo.fabric.label}</div>
              <div className="text-sm text-muted">{kg(fifo.totalG, 1)} kg on the racks · oldest first · click a roll to see where it is</div></div>
            {!fifo.rolls.length && <div className="text-sm text-muted">No rolls of this fabric on the racks.</div>}
            <div className="flex flex-col gap-1.5">
              {fifo.rolls.map((r, i) => (
                <div key={r.serial} className={`flex items-center gap-3 flex-wrap rounded-lg px-3 py-2 ${i === 0 ? "bg-okbg" : "bg-[#faf9f6]"}`}>
                  <span className={`text-[11px] font-bold w-14 ${i === 0 ? "text-ok" : "text-muted"}`}>{i === 0 ? "FIRST" : `#${i + 1}`}</span>
                  <RollChip serial={r.serial}><b className="mono">{r.serial}</b> · {r.rack ? <><b className="mono">{r.rack}</b> · {r.room}</> : "not on a rack"}</RollChip>
                  <span className="text-sm">{kg(r.kgG, 2)} kg</span>
                  <span className="text-xs text-muted">received {r.received} ({r.ageDays}d) · {r.batch}{r.invoice ? ` · ${r.invoice}` : ""}</span>
                </div>))}
            </div>
          </>}
        </section>)}

      <section className="card p-5 flex flex-col gap-3">
        <div className="font-semibold">Scan the roll labels as they come off the rack</div>
        <ScanBox onScan={(c) => go(c)} placeholder={purpose === "PRODUCTION" && !po ? "Type the style PO first, then scan rolls…" : "Scan a roll label…"} keepFocus={false} />
        {cards.map((c, i) => (
          <div key={i} className={`rounded-lg px-4 py-3 text-sm ${c.ok ? "bg-okbg" : "bg-badbg text-bad"}`}><b className="mono">{c.serial}</b> · {c.msg}</div>))}
      </section>

      {confirm && (
        <div className="fixed inset-0 z-[60] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Not the oldest roll">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirm(null)} />
          <div className="relative card p-5 max-w-md w-full shadow-2xl flex flex-col gap-3">
            <div className="font-semibold text-lg">Oldest roll first?</div>
            <div className="text-sm">{confirm.msg}</div>
            <RollChip serial={confirm.oldest.serial}><b className="mono">{confirm.oldest.serial}</b>{confirm.oldest.rack ? ` · ${confirm.oldest.rack}` : ""} — where is it?</RollChip>
            <div className="flex gap-2 justify-end"><button className="btn-ghost" onClick={() => setConfirm(null)}>I&apos;ll take the oldest</button>
              <button className="btn" onClick={() => { const s = confirm.serial; setConfirm(null); void go(s, true); }}>Take {confirm.serial} anyway</button></div>
          </div>
        </div>)}
    </div>
  );
}
