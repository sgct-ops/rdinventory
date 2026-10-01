import { desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser } from "@/lib/session";
import { DataTable, type Col, type Row } from "@/components/DataTable";

const VIA: Record<string, [string, string]> = { SCAN: ["Scan", "warn"], TO: ["TO", "info"], COUNT: ["Count", "muted"], ADJ: ["Adjustment", "bad"] };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  await pageUser();
  const rows = await db.select().from(schema.rackMoves).orderBy(desc(schema.rackMoves.at)).limit(5000);
  const cols: Col[] = [
    { key: "at", label: "WHEN", kind: "datetime" },
    { key: "serial", label: "ROLL", kind: "mono", href: "_href" },
    { key: "from", label: "FROM", kind: "mono", filter: true },
    { key: "to", label: "TO", kind: "mono", filter: true },
    { key: "via", label: "VIA", kind: "pill", tone: "tone", filter: true },
    { key: "ref", label: "REF", kind: "mono" },
    { key: "by", label: "BY", filter: true },
    { key: "note", label: "NOTE", wide: true },
  ];
  const data: Row[] = rows.map((e) => ({
    _id: e.id, _href: `/rolls/${e.serial}`, at: e.at, serial: e.serial, from: e.fromLabel, to: e.toLabel,
    via: VIA[e.via]?.[0] ?? e.via, tone: VIA[e.via]?.[1] ?? "muted", ref: e.ref, by: e.by.split("@")[0], note: e.note,
  }));
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-4 min-w-0">
      <div><div className="h1">Rack movements</div><div className="sub">Every change of place: when, what moved, from where to where, and what caused it.</div></div>
      <DataTable id="rackmoves" initialQuery={q} cols={cols} rows={data} csvName="rack-movements" empty="No movements yet" />
    </div>
  );
}
