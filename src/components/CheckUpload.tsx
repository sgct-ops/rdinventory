"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCheckAction } from "@/app/actions";

export function CheckUpload() {
  const router = useRouter();
  const [stock, setStock] = useState<File | null>(null);
  const [ledger, setLedger] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    if (!stock) return;
    setBusy(true); setErr(null);
    const r = await createCheckAction({ stockName: stock.name, stockCsv: await stock.text(), ledgerName: ledger?.name, ledgerCsv: ledger ? await ledger.text() : undefined });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    router.push(`/check/${r.data}`);
  }
  return (
    <div className="card p-5 flex flex-col gap-4 max-w-3xl">
      <div className="font-semibold">New spot check · about 15 minutes</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label className="label">1 · The day&apos;s fabric_stock_YYYY-MM-DD.csv *</label><input type="file" accept=".csv" className="text-sm" onChange={(e) => setStock(e.target.files?.[0] ?? null)} /></div>
        <div><label className="label">fabric_ledger_YYYY-MM-DD.csv (for the TO match)</label><input type="file" accept=".csv" className="text-sm" onChange={(e) => setLedger(e.target.files?.[0] ?? null)} /></div>
      </div>
      <div className="text-xs text-muted">Both files are in stock-desk\output\fabric on your computer. The check never corrects anything — a confirmed error is fixed with an Adjustment (“Spot-check correction”) or in Zoho.</div>
      {err && <div className="text-sm bg-badbg text-bad rounded-md px-3 py-2">{err}</div>}
      <div><button className="btn" disabled={!stock || busy} onClick={go}>{busy ? "Comparing…" : "Compare"}</button></div>
    </div>
  );
}
