"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordWeighAction, finishCheckAction } from "@/app/actions";
import { kg } from "./ScanBox";

type W = { serial: string; location: string; rack: string | null; sheetG: number; weighedG: number | null };
export function CheckWeigh({ checkId, rolls, done }: { checkId: string; rolls: W[]; done: boolean }) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="font-semibold">5 · Weigh these rolls</div>
      <div className="text-xs text-muted">Picked at random from the flagged locations (all locations when nothing is flagged). The inventory person weighs them; the difference against the app shows here.</div>
      <table className="tbl"><thead><tr><th>ROLL</th><th>WHERE</th><th className="text-right">APP KG</th><th>WEIGHED KG</th><th className="text-right">DIFF</th></tr></thead>
        <tbody>{rolls.map((r) => {
          const diff = r.weighedG !== null ? r.weighedG - r.sheetG : null;
          return (
            <tr key={r.serial}><td className="mono">{r.serial}</td><td>{r.location}{r.rack ? ` · ${r.rack}` : ""}</td><td className="text-right">{kg(r.sheetG)}</td>
              <td>{done ? (r.weighedG !== null ? kg(r.weighedG) : "—") : (
                <div className="flex gap-2"><input className="input w-28 h-8" inputMode="decimal" defaultValue={r.weighedG !== null ? (r.weighedG / 1000).toString() : ""}
                  onChange={(e) => setVals((v) => ({ ...v, [r.serial]: e.target.value }))} />
                  <button className="btn-ghost btn-sm" onClick={async () => { const x = await recordWeighAction(checkId, r.serial, vals[r.serial] ?? ""); if (!x.ok) setErr(x.error); else { setErr(null); router.refresh(); } }}>Save</button></div>)}</td>
              <td className={`text-right font-semibold ${diff !== null && Math.abs(diff) > 200 ? "text-bad" : ""}`}>{diff !== null ? `${diff > 0 ? "+" : ""}${kg(diff)}` : ""}</td></tr>);
        })}{!rolls.length && <tr><td colSpan={5} className="text-muted text-center py-4">No labelled rolls in stock to pick</td></tr>}</tbody></table>
      {err && <div className="text-sm bg-badbg text-bad rounded-md px-3 py-2">{err}</div>}
      {!done && <div className="flex gap-2 items-end flex-wrap border-t border-line pt-3">
        <div className="flex-1 min-w-[260px]"><label className="label">6 · Notes for Check History</label><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <button className="btn" onClick={async () => { const x = await finishCheckAction(checkId, notes); if (!x.ok) setErr(x.error); else router.refresh(); }}>Save to Check History</button></div>}
    </div>
  );
}
