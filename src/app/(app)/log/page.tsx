import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import Link from "next/link";
import { db, schema } from "@/db";
import { pageUser, NAV_ROLES } from "@/lib/session";
import { DataTable, type Col, type Row } from "@/components/DataTable";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const u = await pageUser(NAV_ROLES.log);
  const src = alias(schema.locations, "src"), dst = alias(schema.locations, "dst");
  const rows = await db.select({ l: schema.toLines, t: schema.transferOrders, r: schema.rolls, s: src, d: dst }).from(schema.toLines)
    .innerJoin(schema.transferOrders, eq(schema.transferOrders.id, schema.toLines.toId))
    .innerJoin(schema.rolls, eq(schema.rolls.id, schema.toLines.rollId))
    .innerJoin(src, eq(src.id, schema.transferOrders.sourceLocationId))
    .innerJoin(dst, eq(dst.id, schema.transferOrders.destLocationId))
    .orderBy(desc(schema.transferOrders.postedAt), schema.rolls.serial).limit(5000);
  const cols: Col[] = [
    { key: "to", label: "TO #", kind: "mono", href: "_href" },
    { key: "type", label: "TYPE", kind: "pill", tone: "typeTone", filter: true },
    { key: "date", label: "DATE", kind: "date" },
    { key: "src", label: "SOURCE", filter: true },
    { key: "dst", label: "DESTINATION", filter: true },
    { key: "row", label: "ROW", kind: "num", hidden: true },
    { key: "roll", label: "ROLL", kind: "mono", href: "rollHref", sub: "cutFrom" },
    { key: "rack", label: "RACK", kind: "mono", hidden: true },
    { key: "batch", label: "BATCH", kind: "mono", hidden: true },
    { key: "fabricNo", label: "FABRIC #", kind: "mono", filter: true },
    { key: "kg", label: "KG", kind: "kg", total: true },
    { key: "waste", label: "WASTE", kind: "kg", total: true },
    { key: "stylePO", label: "STYLE PO", kind: "mono", filter: true },
    { key: "mo", label: "MO #", hidden: true },
    { key: "inv", label: "TAX INV", hidden: true },
    { key: "reason", label: "REASON", wide: true, hidden: true },
    { key: "by", label: "POSTED BY", filter: true, hidden: true },
    { key: "at", label: "POSTED AT", kind: "datetime" },
    { key: "zoho", label: "ZOHO", kind: "zoho", filter: true },
  ];
  const data: Row[] = rows.map(({ l, t, r, s, d }) => ({
    _id: l.id, _toId: t.id, _href: `/log/${t.id}`, _muted: t.isReversal, _disabled: u.role === "VIEWER",
    to: t.toNumber, type: (t.type === "TRANSFER" ? "Transfer" : "Consumption") + (t.isReversal ? " · reversal" : ""), typeTone: t.isReversal ? "muted" : t.type === "TRANSFER" ? "info" : "warn",
    date: t.date, src: s.name, dst: d.name, row: l.itemRow, roll: r.serial, rollHref: `/rolls/${r.serial}`, cutFrom: l.cutFromSerial ? `cut from ${l.cutFromSerial}` : "",
    rack: l.rackCode, batch: l.batchCode, fabricNo: l.fabricNo, kg: l.kgG, waste: l.wasteG || null, stylePO: t.stylePO, mo: t.moNumber, inv: t.taxInvoiceNo,
    reason: t.reason, by: t.postedBy, at: t.postedAt, zoho: t.enteredInZoho,
  }));
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-4 min-w-0">
      <div><div className="h1">Transfer orders</div><div className="sub">Every posted line, one row per roll per TO (the TO Log). Tick Zoho once the same TRO number is in Zoho, or use the <Link className="underline" href="/zoho?q=ALL">Zoho prompt</Link>.</div></div>
      <DataTable id="tolog" initialQuery={q} cols={cols} rows={data} csvName="to-log" empty="Nothing posted yet" />
    </div>
  );
}
