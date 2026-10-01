import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser, NAV_ROLES } from "@/lib/session";
import { fmtDate, fmtDateTime, fmtKg } from "@/lib/units";
import { CheckUpload } from "@/components/CheckUpload";

export default async function Page() {
  await pageUser(NAV_ROLES.check);
  const rows = await db.select().from(schema.checks).orderBy(desc(schema.checks.createdAt)).limit(100);
  return (
    <div className="p-5 lg:p-7 flex flex-col gap-5">
      <div><div className="h1">Carbonwork check</div><div className="sub">This app is the source of truth; Carbonwork is the check. Gaps are flagged and investigated, never auto-corrected.</div></div>
      <CheckUpload />
      <div className="card overflow-x-auto"><div className="px-4 py-3 border-b border-line font-semibold">Check History</div>
        <table className="tbl"><thead><tr><th>RUN</th><th>FILE DATE</th><th>FILE</th><th className="text-right">ROWS</th><th className="text-right">FLAGGED</th><th className="text-right">KG GAP</th><th className="text-right">WEIGHED</th><th>STATUS</th><th>BY</th><th>NOTES</th></tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.id}><td><Link className="underline" href={`/check/${c.id}`}>{fmtDateTime(c.createdAt)}</Link></td><td>{fmtDate(c.fileDate)}</td><td className="mono text-xs">{c.fileName}</td>
              <td className="text-right">{c.rowsChecked}</td><td className={`text-right ${c.rowsFlagged ? "text-bad font-semibold" : ""}`}>{c.rowsFlagged}</td><td className="text-right">{fmtKg(c.kgGapG, 1)}</td>
              <td className="text-right">{c.rollsWeighed}</td><td>{c.status === "DONE" ? "done" : <span className="text-accent">open</span>}</td><td className="text-muted text-xs">{c.createdBy}</td><td className="text-muted">{c.notes}</td></tr>))}
            {!rows.length && <tr><td colSpan={10} className="text-center text-muted py-6">No checks yet</td></tr>}</tbody></table></div>
    </div>
  );
}
