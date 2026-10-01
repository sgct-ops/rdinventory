"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ScanBox, kg } from "../ScanBox";
import { startCountAction, countScanAction, countFixAction, finishCountAction, cancelCountAction } from "@/app/actions";

type R = { serial: string; remainingG: number };
export type CountState = {
  countId: string; rack: string; room: string; started: string;
  found: R[]; notYet: R[]; unexpected: { serial: string; map: string }[];
  done: null | { gaps: number; missing: string[] };
};

export function CountView({ state, racks, autoStart }: { state: CountState | null; racks: string[]; autoStart?: string }) {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };
  const Rd = "oklch(0.58 0.17 28)";

  async function start(code: string) {
    const r = await startCountAction(code);
    if (!r.ok) return flash(r.error);
    router.replace(`/warehouse/count?id=${r.data!.countId}`);
  }
  async function onScan(code: string) {
    if (!state || state.done) {
      if (code.startsWith("RK-")) return start(code);
      return flash("Scan a rack label to start the count");
    }
    if (code.startsWith("RK-")) return flash("Counting " + state.rack + ". Press Other rack to switch.");
    const r = await countScanAction(state.countId, code);
    if (!r.ok) return flash(r.error);
    router.refresh();
  }

  const started = useRef(false);
  useEffect(() => {
    if (autoStart && !state && !started.current) { started.current = true; start(autoStart); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, state]);

  if (!state) return (
    <div className="p-6 flex flex-col gap-4 items-start">
      <div className="text-2xl font-semibold">Count a rack</div>
      <div className="text-[15px] text-muted">Scan the rack label to start, or pick one.</div>
      <div className="w-full max-w-xl"><ScanBox onScan={onScan} placeholder="Scan rack label…" /></div>
      {toast && <div className="text-sm bg-badbg text-bad rounded-md px-3 py-2">{toast}</div>}
      <div className="flex gap-2 flex-wrap">{racks.map((c) => (
        <button key={c} onClick={() => start(c)} className="px-4 py-3 rounded-[10px] border border-[#d6d2c9] bg-white mono font-semibold text-[15px]">{c}</button>))}</div>
    </div>
  );
  const exp = state.found.length + state.notYet.length;
  const dn = state.done;
  return (
    <div className="flex flex-col p-6 gap-4 min-h-[calc(100vh-60px)]">
      <div className="flex items-center gap-3.5 flex-wrap">
        <div className="text-2xl font-semibold">Counting</div>
        <div className="mono font-semibold text-[22px] px-3 py-1 rounded-lg bg-ink text-white">{state.rack}</div>
        <div className="text-sm text-muted">{state.room} · started {state.started}</div>
      </div>
      {!dn && <ScanBox onScan={onScan} placeholder={`Scan every roll physically on ${state.rack}…`} />}
      {toast && <div className="text-sm bg-badbg text-bad rounded-md px-3 py-2">{toast}</div>}
      <div className="flex items-center gap-4">
        <div className="flex-1 h-3.5 bg-line rounded-full overflow-hidden"><div className="h-full bg-ok" style={{ width: exp ? `${(state.found.length / exp) * 100}%` : "0%" }} /></div>
        <div className="text-xl font-semibold">{state.found.length} / {exp}</div>
      </div>
      {dn && (
        <div className="rounded-xl px-4 py-3.5 text-[15px] flex items-center gap-3.5 flex-wrap" style={{ background: dn.gaps ? "oklch(0.95 0.03 28)" : "oklch(0.95 0.03 150)" }}>
          <div className="flex-1">{dn.gaps ? `Count saved. ${dn.gaps} roll${dn.gaps > 1 ? "s" : ""} not found: ${dn.missing.join(", ")}. Flagged as Missing for follow-up.` : "Count saved. Every roll found."}</div>
          <button className="btn btn-sm" onClick={() => router.push("/warehouse/counts")}>See all counts</button>
          <button className="btn-ghost btn-sm" onClick={() => router.replace("/warehouse/count")}>Count another rack</button>
        </div>
      )}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3.5 min-h-0">
        <div className="card p-4 flex flex-col gap-1 overflow-hidden">
          <div className="flex justify-between mb-1.5"><div className="font-semibold">Found</div><div className="font-semibold text-ok">{state.found.length}</div></div>
          {state.found.slice(-10).reverse().map((r) => <div key={r.serial} className="mono text-sm py-2 border-b border-line2">✓ {r.serial}</div>)}
          {state.found.length > 10 && <div className="text-[13px] text-faint pt-1.5">+ {state.found.length - 10} more</div>}
        </div>
        <div className="card p-4 flex flex-col gap-1 overflow-hidden">
          <div className="flex justify-between mb-1.5"><div className="font-semibold">{dn ? "Missing" : "Not scanned yet"}</div><div className="font-semibold">{dn ? dn.gaps : state.notYet.length}</div></div>
          {(dn ? state.notYet.filter((r) => dn.missing.includes(r.serial)) : state.notYet).slice(0, 10).map((r) => (
            <div key={r.serial} className="mono text-sm py-2 border-b border-line2" style={{ color: dn ? Rd : "#6d6a63" }}>{r.serial} · {kg(r.remainingG, 1)}</div>))}
          {state.notYet.length > 10 && <div className="text-[13px] text-faint pt-1.5">+ {state.notYet.length - 10} more</div>}
        </div>
        <div className="bg-warnbg border border-warn rounded-xl p-4 flex flex-col gap-2.5 overflow-hidden">
          <div className="flex justify-between"><div className="font-semibold">Not expected here</div><div className="font-semibold">{state.unexpected.length}</div></div>
          {state.unexpected.map((r) => (
            <div key={r.serial} className="bg-white rounded-[10px] p-3 flex flex-col gap-2">
              <div className="mono font-semibold">{r.serial}</div><div className="text-sm text-muted">Map says {r.map}</div>
              {!dn && <button className="btn h-11" onClick={async () => { const x = await countFixAction(state.countId, r.serial); if (!x.ok) flash(x.error); router.refresh(); }}>It&apos;s on {state.rack} now</button>}
            </div>))}
        </div>
      </div>
      {!dn && (
        <div className="flex gap-2.5 justify-end items-center flex-wrap">
          <input className="input max-w-sm" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-ghost h-[52px] px-5" onClick={async () => { await cancelCountAction(state.countId); router.replace("/warehouse/count"); }}>Other rack</button>
          <button className="btn h-[52px] px-6 text-[15px]" onClick={async () => {
            if (state.notYet.length && !confirm(`${state.notYet.length} roll(s) not scanned will be flagged Missing. Finish?`)) return;
            const r = await finishCountAction(state.countId, note); if (!r.ok) flash(r.error); router.refresh();
          }}>Finish · {state.notYet.length} not found</button>
        </div>
      )}
    </div>
  );
}
