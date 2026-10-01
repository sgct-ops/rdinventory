import Link from "next/link";
import { asc, desc, eq, isNotNull, and, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser } from "@/lib/session";
import { fmtDateTime } from "@/lib/units";
import { DataTable } from "@/components/DataTable";

export default async function Page() {
  const u = await pageUser();
  const racks = await db.select().from(schema.racks).where(eq(schema.racks.active, true)).orderBy(asc(schema.racks.sortOrder), asc(schema.racks.code));
  const hist = await db.select({ c: schema.rackCounts, code: schema.racks.code }).from(schema.rackCounts)
    .innerJoin(schema.racks, eq(schema.racks.id, schema.rackCounts.rackId))
    .where(and(isNotNull(schema.rackCounts.finishedAt), ne(schema.rackCounts.note, "Cancelled")))
    .orderBy(desc(schema.rackCounts.finishedAt)).limit(2000);
  const week = 7 * 86400_000;
  const canCount = ["ADMIN", "INVENTORY"].includes(u.role);
  return (
    <div className="flex flex-col">
      <div className="px-5 lg:px-7 pt-6 flex items-center gap-4"><div className="h1">Past counts</div><div className="text-[13px] text-muted">Each rack counted at least once a week</div></div>
      <div className="px-5 lg:px-7 py-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
        {racks.map((r) => {
          const overdue = !r.lastCountedAt || Date.now() - r.lastCountedAt.getTime() > week;
          const bar = overdue ? "oklch(0.8 0.13 80)" : r.lastCountGaps ? "oklch(0.58 0.17 28)" : "oklch(0.62 0.12 150)";
          return (
            <div key={r.id} className="card p-4 flex flex-col gap-2.5 border-t-4" style={{ borderTopColor: bar }}>
              <div className="flex items-baseline gap-2"><Link href={`/warehouse/racks/${r.code}`} className="mono font-semibold text-lg">{r.code}</Link><div className="text-xs text-muted">{r.room}</div></div>
              <div className="text-[13px]"><span className="text-muted">Last count</span> {r.lastCountedAt ? fmtDateTime(r.lastCountedAt) : "never"}</div>
              <div className="text-[13px] font-medium">{overdue ? "Overdue" : r.lastCountGaps ? `${r.lastCountGaps} missing` : "0 gaps"}</div>
              {canCount && <Link href={`/warehouse/count?rack=${r.code}`} className="mt-1 text-xs p-2 border border-[#d6d2c9] rounded-md text-center">Count now</Link>}
            </div>
          );
        })}
      </div>
      <div className="mx-4 lg:mx-7 mb-7 min-w-0">
        <DataTable id="counts" csvName="rack-counts" empty="No counts yet" initialSort={{ key: "at", dir: "desc" }}
          cols={[
            { key: "at", label: "DATE", kind: "datetime" }, { key: "rack", label: "RACK", kind: "mono", href: "_href", filter: true },
            { key: "expected", label: "EXPECTED", kind: "num", total: true }, { key: "found", label: "FOUND", kind: "num", total: true },
            { key: "gaps", label: "GAPS", kind: "num", total: true }, { key: "by", label: "BY", filter: true }, { key: "note", label: "NOTE", wide: true },
          ]}
          rows={hist.map(({ c, code }) => ({ _id: c.id, _href: `/warehouse/racks/${code}`, at: c.finishedAt, rack: code, expected: c.expected, found: c.found, gaps: c.gaps, by: c.by, note: c.note }))} />
      </div>
    </div>
  );
}
