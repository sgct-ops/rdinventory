import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser, NAV_ROLES } from "@/lib/session";
import { DataTable, type Col, type Row } from "@/components/DataTable";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  await pageUser(NAV_ROLES.log);
  const rows = await db.select({ o: schema.orderLinks, t: schema.transferOrders }).from(schema.orderLinks)
    .innerJoin(schema.transferOrders, eq(schema.transferOrders.id, schema.orderLinks.toId))
    .orderBy(desc(schema.transferOrders.postedAt), schema.orderLinks.pieceIndex).limit(10000);
  const cols: Col[] = [
    { key: "order", label: "ORDER #", kind: "mono", href: "_href" },
    { key: "piece", label: "PIECE", kind: "num" },
    { key: "to", label: "TO #", kind: "mono", href: "toHref" },
    { key: "date", label: "DATE", kind: "date" },
    { key: "stylePO", label: "STYLE PO", kind: "mono", filter: true },
    { key: "fabricNo", label: "FABRIC #", kind: "mono", filter: true },
    { key: "colour", label: "COLOUR", filter: true },
    { key: "kg", label: "KG / PIECE", kind: "kg3", total: true },
    { key: "rolls", label: "ROLL SERIAL(S)", kind: "links" },
    { key: "state", label: "STATE", kind: "pill", tone: "tone", filter: true },
  ];
  const data: Row[] = rows.map(({ o, t }) => ({
    _id: o.id, _href: `/find?q=${encodeURIComponent(o.orderNumber)}`, _strike: o.reversed,
    order: o.orderNumber, piece: o.pieceIndex, to: t.toNumber, toHref: `/log/${t.id}`, date: t.date, stylePO: o.stylePO, fabricNo: o.fabricNo, colour: o.colour,
    kg: o.kgPerPieceG, rolls: o.rollSerials.split(", ").filter(Boolean).map((s) => ({ t: s, h: `/rolls/${s}` })),
    state: o.reversed ? "Reversed" : "Active", tone: o.reversed ? "muted" : "ok",
  }));
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-4 min-w-0">
      <div><div className="h1">Customer orders</div><div className="sub">One row per piece: which TO and which roll(s) its fabric came from.</div></div>
      <DataTable id="orders" initialQuery={q} cols={cols} rows={data} csvName="order-links" empty="No pieces linked yet" />
    </div>
  );
}
