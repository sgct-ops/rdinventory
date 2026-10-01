"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { loadDemoAction, removeDemoAction, rebuildAction } from "@/app/actions";
import { backupNowAction, healthNowAction } from "@/app/admin-actions";

export function AdminTools({ demoLoaded }: { demoLoaded: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const go = async (key: string, fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, ok: (d: unknown) => string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(key); setMsg(null);
    const r = await fn(); setBusy(null);
    setMsg(r.ok ? { ok: true, t: ok(r.data) } : { ok: false, t: r.error! });
    router.refresh();
  };
  const Card = ({ title, text, children }: { title: string; text: string; children: React.ReactNode }) => (
    <div className="card p-5 flex flex-col gap-3"><div className="font-semibold">{title}</div><div className="text-sm text-muted">{text}</div><div className="flex gap-2 flex-wrap mt-auto">{children}</div></div>
  );
  return (
    <div className="flex flex-col gap-4">
      {msg && <div className={`text-sm rounded-md px-3 py-2 whitespace-pre-wrap ${msg.ok ? "bg-okbg" : "bg-badbg text-bad"}`}>{msg.t}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Demo data" text="Fills every page with example data: 5 fabrics (990A, 990B, 991A, 991B, 992), rolls put away on racks, transfer and consumption orders with a cut piece and a reversal, order numbers, adjustments, labels, users and a spot check. All marked DEMO; Remove takes it out and puts the TO number series back.">
          <button className="btn" disabled={!!busy || demoLoaded} onClick={() => go("load", loadDemoAction, (d) => { const x = d as { rolls: number; T: Record<string, string> }; return `Demo data loaded: ${x.rolls} rolls, orders ${x.T.a} to ${x.T.i}. ${x.T.hr} reverses ${x.T.h}. Try Find → #CT10341.`; }, "Load demo data?")}>{busy === "load" ? "Loading…" : "Load demo data"}</button>
          <button className="btn-ghost" disabled={!!busy || !demoLoaded} onClick={() => go("remove", removeDemoAction, () => "Demo data removed.", "Remove every demo row? Real data is not touched.")}>{busy === "remove" ? "Removing…" : "Remove demo data"}</button>
        </Card>
        <Card title="Rebuild roll balances from the logs" text="Recomputes every roll's location, consumed, adjusted, cut-off and remaining kg from the TO Log and approved adjustments, fixes any difference and records it in Audit. The 8 am health check flags differences in red first.">
          <button className="btn-ghost" disabled={!!busy} onClick={() => go("rebuild", rebuildAction, (d) => { const x = d as string[]; return x.length ? `${x.length} rolls corrected:\n${x.slice(0, 20).join("\n")}` : "All roll balances match the logs."; })}>{busy === "rebuild" ? "Rebuilding…" : "Rebuild now"}</button>
        </Card>
        <Card title="Backup" text="Runs by itself every night at 11 pm (Vercel Cron). Your database host also keeps point-in-time restore.">
          <button className="btn-ghost" disabled={!!busy} onClick={() => go("backup", backupNowAction, () => "Backup saved.")}>Back up now</button>
        </Card>
        <Card title="Health check" text="Runs by itself every morning at 8 am: rolls below 0 kg, labels waiting more than 3 days, pending adjustments, TOs not ticked in Zoho after 2 days, and a re-derivation of every roll from the logs.">
          <button className="btn-ghost" disabled={!!busy} onClick={() => go("health", healthNowAction, () => "Health check done — see the list below.")}>Run now</button>
        </Card>
      </div>
    </div>
  );
}
