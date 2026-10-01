"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { decideAdjustmentAction, reverseAdjustmentAction, reverseTOAction, setZohoAction } from "@/app/actions";

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const go = async (fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, done?: (d: unknown) => string | void) => {
    setBusy(true); const r = await fn(); setBusy(false);
    if (!r.ok) alert(r.error); else { const m = done?.(r.data); if (m) alert(m); router.refresh(); }
  };
  return { busy, go };
}

export function DecideButtons({ id }: { id: string }) {
  const { busy, go } = useRun();
  return (
    <div className="flex gap-2">
      <button className="btn btn-sm" disabled={busy} onClick={() => { const n = prompt("Approve — note (optional)", ""); if (n !== null) go(() => decideAdjustmentAction(id, true, n)); }}>Approve</button>
      <button className="btn-danger" disabled={busy} onClick={() => { const n = prompt("Reject — why?", ""); if (n) go(() => decideAdjustmentAction(id, false, n)); }}>Reject</button>
    </div>
  );
}
export function ReverseAdjButton({ id }: { id: string }) {
  const { busy, go } = useRun();
  return <button className="btn-danger" disabled={busy} onClick={() => { const n = prompt("Reverse this adjustment — reason?"); if (n) go(() => reverseAdjustmentAction(id, n), (d) => `Reversed by ${(d as { number: string }).number}`); }}>Reverse</button>;
}
export function ReverseTOButton({ toNumber, canUndo, canReverse }: { toNumber: string; canUndo: boolean; canReverse: boolean }) {
  const { busy, go } = useRun();
  if (!canUndo && !canReverse) return null;
  return (
    <button className="btn-danger" disabled={busy} onClick={() => {
      const n = prompt(`Reverse ${toNumber} — reason?${canReverse ? "" : " (allowed within the undo window)"}`);
      if (n) go(() => reverseTOAction(toNumber, n), (d) => `${toNumber} reversed by ${(d as { by: string }).by}. Make the same reversal in Zoho.`);
    }}>{canReverse ? "Reverse" : "Undo"}</button>
  );
}
export function ZohoTick({ id, value, disabled }: { id: string; value: boolean; disabled?: boolean }) {
  const { busy, go } = useRun();
  return <input type="checkbox" className="w-4 h-4 cursor-pointer" checked={value} disabled={busy || disabled} onChange={(e) => go(() => setZohoAction(id, e.target.checked))} title="Entered in Zoho" />;
}
