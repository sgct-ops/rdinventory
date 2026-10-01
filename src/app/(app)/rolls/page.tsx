import Link from "next/link";
import { desc, eq, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser } from "@/lib/session";
import { DataTable, type Col, type Row } from "@/components/DataTable";

const STATUS: Record<string, [string, string]> = { IN_STOCK: ["In stock", "ok"], AWAITING_LABEL: ["Awaiting label", "warn"], FINISHED: ["Finished", "muted"] };

export default async function Page({ searchParams }: { searchParams: Promise<{ all?: string; q?: string }> }) {
  await pageUser();
  const sp = await searchParams;
  const all = sp.all === "1";
  const rows = await db.select({ r: schema.rolls, f: schema.fabricItems, b: schema.batches, l: schema.locations, k: schema.racks }).from(schema.rolls)
    .innerJoin(schema.fabricItems, eq(schema.fabricItems.id, schema.rolls.fabricItemId))
    .innerJoin(schema.batches, eq(schema.batches.id, schema.rolls.batchId))
    .innerJoin(schema.locations, eq(schema.locations.id, schema.rolls.currentLocationId))
    .leftJoin(schema.racks, eq(schema.racks.id, schema.rolls.rackId))
    .where(all ? undefined : ne(schema.rolls.status, "FINISHED")).orderBy(desc(schema.rolls.createdAt)).limit(5000);

  const rackLocs = new Set((await db.select({ l: schema.racks.locationId }).from(schema.racks)).map((x) => x.l));
  const cols: Col[] = [
    { key: "serial", label: "SERIAL", kind: "mono", href: "_href", sub: "cut" },
    { key: "fabricNo", label: "FABRIC #", kind: "mono", filter: true },
    { key: "fabric", label: "FABRIC · COLOUR", wide: true },
    { key: "group", label: "GROUP", filter: true, hidden: true },
    { key: "batch", label: "BATCH", kind: "mono" },
    { key: "po", label: "FABRIC PO", kind: "mono", filter: true },
    { key: "registered", label: "REGISTERED", kind: "date" },
    { key: "location", label: "LOCATION", filter: true },
    { key: "rack", label: "RACK", kind: "mono", filter: true },
    { key: "weighed", label: "WEIGHED", kind: "kg", total: true },
    { key: "used", label: "USED", kind: "kg", hidden: true },
    { key: "adj", label: "ADJ", kind: "kg", hidden: true },
    { key: "cutOff", label: "CUT OFF", kind: "kg", hidden: true },
    { key: "left", label: "LEFT", kind: "kg", total: true },
    { key: "status", label: "STATUS", kind: "pill", tone: "tone", filter: true },
  ];
  const data: Row[] = rows.map(({ r, f, b, l, k }) => ({
    _id: r.id, _href: `/rolls/${r.serial}`, serial: r.serial, cut: r.splitFromId ? "cut piece" : "",
    fabricNo: f.fabricNo, fabric: `${f.itemName ?? ""}${f.colour ? ` · ${f.colour}` : ""}`, group: f.group, batch: b.code, po: r.fabricPO,
    registered: r.registeredDate, location: l.name, rack: k?.code ?? (r.status !== "FINISHED" && rackLocs.has(r.currentLocationId) ? "Unplaced" : ""),
    weighed: r.weighedG, used: r.consumedG, adj: r.adjustedG, cutOff: r.splitG || null, left: r.remainingG,
    status: r.status === "IN_STOCK" && !r.labelActivatedAt ? "Label to scan" : STATUS[r.status][0],
    tone: r.status === "IN_STOCK" && !r.labelActivatedAt ? "warn" : STATUS[r.status][1],
  }));
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-4 min-w-0">
      <div><div className="h1">All rolls</div><div className="sub">The roll register. Search, filter, sort and download. Click a roll to open it.</div></div>
      <DataTable id="rolls" initialQuery={sp.q} cols={cols} rows={data} csvName="rolls" empty="No rolls yet"
        toolbar={<Link href={`/rolls${all ? "" : "?all=1"}${sp.q ? `${all ? "?" : "&"}q=${encodeURIComponent(sp.q)}` : ""}`} className={`h-10 px-3 rounded-lg border text-[13px] grid place-items-center ${all ? "border-ink bg-ink text-white hover:text-white" : "border-[#d6d2c9] bg-white"}`}>{all ? "Including finished" : "Show finished too"}</Link>} />
    </div>
  );
}
