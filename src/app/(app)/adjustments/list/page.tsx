import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser } from "@/lib/session";
import { ADJ_REASONS } from "@/lib/posting";
import { DataTable, type Col, type Row } from "@/components/DataTable";

const TONE: Record<string, string> = { APPROVED: "ok", PENDING: "warn", REJECTED: "bad" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const u = await pageUser(["ADMIN", "INVENTORY", "MERCHANDISER"]);
  const rows = await db.select({ a: schema.adjustments, r: schema.rolls }).from(schema.adjustments)
    .innerJoin(schema.rolls, eq(schema.rolls.id, schema.adjustments.rollId)).orderBy(desc(schema.adjustments.requestedAt)).limit(5000);
  const reversed = new Set(rows.map(({ a }) => a.reversalOfId).filter(Boolean));
  const cols: Col[] = [
    { key: "num", label: "#", kind: "mono" },
    { key: "roll", label: "ROLL", kind: "mono", href: "_href" },
    { key: "change", label: "CHANGE", kind: "signedkg", total: true },
    { key: "before", label: "BEFORE", kind: "kg", hidden: true },
    { key: "after", label: "AFTER", kind: "kg" },
    { key: "reason", label: "REASON", filter: true },
    { key: "note", label: "NOTE", wide: true },
    { key: "status", label: "STATUS", kind: "pill", tone: "tone", filter: true },
    { key: "asked", label: "ASKED BY", filter: true },
    { key: "askedAt", label: "ASKED", kind: "datetime" },
    { key: "decided", label: "DECIDED BY", hidden: true },
    { key: "decidedAt", label: "DECIDED", kind: "datetime", sub: "decision" },
    ...(u.role === "ADMIN" ? [{ key: "rev", label: "", kind: "reverseAdj" } as Col] : []),
  ];
  const data: Row[] = rows.map(({ a, r }) => ({
    _id: a.id, _href: `/rolls/${r.serial}`, num: a.number, roll: r.serial, change: a.kgChangeG, before: a.rollBeforeG, after: a.rollAfterG,
    reason: ADJ_REASONS[a.reason], note: a.note, status: a.status.charAt(0) + a.status.slice(1).toLowerCase(), tone: TONE[a.status] ?? "muted",
    asked: a.requestedBy, askedAt: a.requestedAt, decided: a.decidedBy, decidedAt: a.decidedAt, decision: a.decisionNote,
    rev: u.role === "ADMIN" && a.status === "APPROVED" && !a.reversalOfId && !reversed.has(a.id) ? a.id : null,
  }));
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-4 min-w-0">
      <div><div className="h1">Past adjustments</div><div className="sub">Every adjustment, with who asked and who decided.</div></div>
      <DataTable id="adjustments" initialQuery={q} cols={cols} rows={data} csvName="adjustments" empty="No adjustments yet" />
    </div>
  );
}
