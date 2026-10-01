"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { locateAction } from "@/app/actions";
import { kg } from "./ScanBox";

type Loc = {
  serial: string; fabricNo: string | null; item: string; colour: string | null; sku: string | null; batch: string; invoice: string | null; po: string;
  kgG: number; status: string; location: string; onRack: boolean; rack: string | null; room: string | null; building: string | null;
  roomRacks: { code: string; capacity: number; n: number }[]; takenOut: { purpose: string | null; for: string | null; by: string | null; at: string } | null;
  offRack: string | null; received: string;
};

/** Floating card: exactly where a roll is — building, room, rack — with the room's racks drawn and this one lit up. */
export function LocatorModal({ serial, onClose }: { serial: string; onClose: () => void }) {
  const [d, setD] = useState<Loc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    let live = true;
    locateAction(serial).then((r) => { if (!live) return; if (r.ok) setD(r.data as Loc); else setErr(r.error); });
    const k = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", k);
    return () => { live = false; window.removeEventListener("keydown", k); };
  }, [serial]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={`Where is ${serial}`}>
      <div className="absolute inset-0 bg-[rgb(28_27_25/.45)]" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-line overflow-hidden">
        <div className="flex items-center gap-3 px-5 h-14 border-b border-line">
          <div className="mono font-semibold text-lg">{serial}</div>
          {d && <div className="text-sm text-muted truncate">{d.fabricNo} · {d.item}{d.colour ? ` · ${d.colour}` : ""}</div>}
          <button className="btn-ghost btn-sm ml-auto" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {err && <div className="p-5 text-bad">{err}</div>}
        {!d && !err && <div className="p-8 text-center text-muted">Finding it…</div>}
        {d && (
          <div className="p-5 flex flex-col gap-4">
            {d.onRack && d.rack ? (
              <div className="rounded-xl bg-ink text-white p-4 flex items-center gap-4">
                <div><div className="text-[11px] tracking-[.1em] text-white/60 mono">RACK</div><div className="mono text-4xl font-bold leading-none mt-1">{d.rack}</div></div>
                <div className="text-sm leading-snug"><div className="font-semibold">{d.room}</div><div className="text-white/70">{d.building} · {d.location}</div></div>
              </div>
            ) : (
              <div className="rounded-xl bg-warnbg p-4 text-sm">
                <div className="font-semibold">Not on a rack right now</div>
                <div className="mt-0.5">{d.takenOut ? `Taken out for ${d.takenOut.purpose === "TROR" ? d.takenOut.for : `${(d.takenOut.purpose ?? "").toLowerCase()}${d.takenOut.for ? ` · ${d.takenOut.for}` : ""}`} by ${d.takenOut.by?.split("@")[0]} on ${new Date(d.takenOut.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.`
                  : `At ${d.location}${d.rack ? `, last on ${d.rack} (${d.room})` : ""}. ${d.offRack === "NEW" ? "New — waiting to be put away." : d.offRack === "RETURNED" ? "Came back — waiting to be put away." : ""}`}</div>
              </div>
            )}
            {d.roomRacks.length > 0 && (
              <div>
                <div className="kicker mb-1.5">{d.room} · {d.building}</div>
                <div className="grid grid-cols-4 gap-2">
                  {d.roomRacks.map((r) => {
                    const on = r.code === d.rack;
                    return (
                      <div key={r.code} className={`rounded-lg border-2 p-2 text-center ${on ? "border-[oklch(0.55_0.17_45)] bg-[oklch(0.96_0.04_60)] shadow-[0_0_0_4px_oklch(0.9_0.08_60)]" : "border-line bg-[#faf9f6]"}`}>
                        <div className={`mono font-semibold ${on ? "text-[oklch(0.45_0.15_45)]" : ""}`}>{r.code}</div>
                        <div className="text-[10.5px] text-muted">{r.n}/{r.capacity}</div>
                        {on && <div className="text-[10px] font-bold text-[oklch(0.45_0.15_45)] mt-0.5">HERE</div>}
                      </div>);
                  })}
                </div>
              </div>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Kg left</dt><dd className="font-semibold">{kg(d.kgG)} kg</dd>
              <dt className="text-muted">Batch</dt><dd className="mono text-xs">{d.batch}</dd>
              <dt className="text-muted">Invoice</dt><dd className="mono text-xs">{d.invoice ?? "—"}</dd>
              <dt className="text-muted">Fabric PO</dt><dd className="mono text-xs">{d.po}</dd>
              <dt className="text-muted">Received</dt><dd>{d.received}</dd>
              {d.sku && <><dt className="text-muted">SKU</dt><dd className="mono text-xs">{d.sku}</dd></>}
            </dl>
            <div className="flex gap-2">
              <Link className="btn-ghost btn-sm" href={`/rolls/${d.serial}`} onClick={onClose}>Open roll</Link>
              {d.rack && <Link className="btn-ghost btn-sm" href={`/warehouse/racks/${d.rack}`} onClick={onClose}>Open rack {d.rack}</Link>}
            </div>
          </div>
        )}
      </div>
    </div>, document.body);
}

/** A pick-list chip: click it to see where the roll is. */
export function RollChip({ serial, children, className = "" }: { serial: string; children?: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={`Where is ${serial}?`}
        className={`inline-flex items-center gap-1.5 text-left rounded-full px-2.5 py-1 text-[12px] bg-paper border border-line hover:border-ink hover:bg-white cursor-pointer ${className}`}>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>
        {children ?? <b className="mono">{serial}</b>}
      </button>
      {open && <LocatorModal serial={serial} onClose={() => setOpen(false)} />}
    </>
  );
}
