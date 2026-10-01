import { desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser } from "@/lib/session";
import { DataTable, type Col, type Row } from "@/components/DataTable";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  await pageUser(["ADMIN"]);
  const rows = await db.select().from(schema.audit).orderBy(desc(schema.audit.at)).limit(5000);
  const cols: Col[] = [
    { key: "at", label: "WHEN", kind: "datetime" },
    { key: "who", label: "WHO", filter: true },
    { key: "action", label: "ACTION", kind: "mono", filter: true },
    { key: "rolls", label: "ROLLS", kind: "mono", wide: true },
    { key: "before", label: "KG BEFORE", kind: "kg" },
    { key: "after", label: "KG AFTER", kind: "kg" },
    { key: "details", label: "DETAILS", kind: "mono", wide: true },
  ];
  const data: Row[] = rows.map((a) => ({ _id: a.id, at: a.at, who: a.userEmail, action: a.action, rolls: a.rollSerials, before: a.kgBeforeG, after: a.kgAfterG, details: a.details ? JSON.stringify(a.details) : "" }));
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-4 min-w-0">
      <div><div className="h1">Audit trail</div><div className="sub">Every action: who, when, what, and kg before and after. Written by the app only.</div></div>
      <DataTable id="audit" initialQuery={q} cols={cols} rows={data} csvName="audit" />
    </div>
  );
}
