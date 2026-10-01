import { desc, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser } from "@/lib/session";
import { fmtDateTime } from "@/lib/units";
import type { HealthIssue } from "@/lib/health";
import { DEMO_FAB_NOS } from "@/lib/demo";
import { AdminTools } from "@/components/AdminTools";

export default async function Page() {
  await pageUser(["ADMIN"]);
  const demo = await db.select({ id: schema.fabricItems.id }).from(schema.fabricItems).where(inArray(schema.fabricItems.fabricNo, DEMO_FAB_NOS)).limit(1);
  const backups = await db.select({ id: schema.backups.id, createdAt: schema.backups.createdAt, sizeBytes: schema.backups.sizeBytes }).from(schema.backups).orderBy(desc(schema.backups.createdAt)).limit(30);
  const reports = await db.select().from(schema.healthReports).orderBy(desc(schema.healthReports.createdAt)).limit(10);
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-5 max-w-5xl">
      <div><div className="h1">Tools</div><div className="sub">Demo data, rebuild, backups and the health check.</div></div>
      <AdminTools demoLoaded={demo.length > 0} />
      <div className="card overflow-x-auto"><div className="px-4 py-3 border-b border-line font-semibold">Health checks</div>
        {reports.map((r) => { const is = r.issues as HealthIssue[]; return (
          <details key={r.id} className="px-4 py-2 border-b border-line2"><summary className="cursor-pointer text-sm">{fmtDateTime(r.createdAt)} · {is.length} item(s) · {is.filter((i) => i.severity === "red").length} red</summary>
            <ul className="text-sm mt-2 mb-2 flex flex-col gap-1">{is.map((i, n) => <li key={n} className={i.severity === "red" ? "text-bad" : ""}>{i.text}</li>)}{!is.length && <li className="text-ok">All good</li>}</ul></details>); })}
        {!reports.length && <div className="p-4 text-sm text-muted">No health checks yet</div>}
      </div>
      <div className="card overflow-x-auto"><table className="tbl"><thead><tr><th>BACKUP</th><th className="text-right">SIZE</th><th></th></tr></thead>
        <tbody>{backups.map((b) => <tr key={b.id}><td>{fmtDateTime(b.createdAt)}</td><td className="text-right">{(b.sizeBytes / 1024).toFixed(0)} KB</td><td><a className="underline text-sm" href={`/api/backups/${b.id}`}>Download (.json.gz)</a></td></tr>)}
          {!backups.length && <tr><td colSpan={3} className="text-center text-muted py-4">No backups yet</td></tr>}</tbody></table></div>
    </div>
  );
}
