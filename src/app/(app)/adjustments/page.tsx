import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser, NAV_ROLES } from "@/lib/session";
import { ADJ_REASONS } from "@/lib/posting";
import { fmtDateTime, fmtKg } from "@/lib/units";
import { DecideButtons } from "@/components/Buttons";

export default async function Page() {
  const u = await pageUser(NAV_ROLES.approve);
  const rows = await db.select({ a: schema.adjustments, r: schema.rolls }).from(schema.adjustments)
    .innerJoin(schema.rolls, eq(schema.rolls.id, schema.adjustments.rollId)).where(eq(schema.adjustments.status, "PENDING")).orderBy(desc(schema.adjustments.requestedAt));
  return (
    <div className="p-5 lg:p-7 flex flex-col gap-4">
      <div><div className="h1">Approve adjustments</div><div className="sub">Pending ones don&apos;t change any kg until you approve. You can&apos;t approve your own.</div></div>
      <div className="card overflow-x-auto"><table className="tbl">
        <thead><tr><th>#</th><th>ROLL</th><th className="text-right">CHANGE</th><th className="text-right">ROLL NOW</th><th>REASON</th><th>NOTE</th><th>PHOTO</th><th>BY</th><th>WHEN</th><th></th></tr></thead>
        <tbody>{rows.map(({ a, r }) => (
          <tr key={a.id}><td className="mono">{a.number}</td><td><Link href={`/rolls/${r.serial}`} className="mono">{r.serial}</Link></td>
            <td className={`text-right font-semibold ${a.kgChangeG < 0 ? "text-bad" : "text-ok"}`}>{a.kgChangeG > 0 ? "+" : ""}{fmtKg(a.kgChangeG)}</td>
            <td className="text-right">{fmtKg(r.remainingG)} → {fmtKg(r.remainingG + a.kgChangeG)}</td>
            <td>{ADJ_REASONS[a.reason]}</td><td className="text-muted max-w-xs">{a.note}</td>
            <td>{a.photoUrl && /^https?:\/\//.test(a.photoUrl) ? <a className="underline" href={a.photoUrl} target="_blank" rel="noreferrer">photo</a> : ""}</td>
            <td className="text-muted">{a.requestedBy}</td><td className="text-muted">{fmtDateTime(a.requestedAt)}</td>
            <td>{a.requestedBy === u.email ? <span className="text-xs text-muted">yours</span> : <DecideButtons id={a.id} />}</td></tr>))}
          {!rows.length && <tr><td colSpan={10} className="text-center text-muted py-6">Nothing waiting</td></tr>}</tbody></table></div>
      <Link href="/adjustments/list" className="text-sm underline">All adjustments</Link>
    </div>
  );
}
