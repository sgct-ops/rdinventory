import { sql } from "drizzle-orm";
import { db } from "@/db";
import { pageUser } from "@/lib/session";
import { DataTable, type Col, type Row } from "@/components/DataTable";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await pageUser();
  const { q } = await searchParams;
  const rows = (await db.execute(sql`
    select r.invoice_no inv, string_agg(distinct r.fabric_po, ', ') pos, string_agg(distinct f.fabric_no, ', ') fabs, min(r.registered_date) first, max(p.vendor) vendor,
      count(*) filter (where r.split_from_id is null)::int rolls,
      coalesce(sum(r.weighed_g) filter (where r.split_from_id is null),0)::int received,
      coalesce(sum(r.consumed_g),0)::int used,
      coalesce(sum(r.remaining_g) filter (where r.status <> 'FINISHED'),0)::int left_g,
      (select string_agg(x.loc || ' ' || round(x.g/1000.0,1) || ' kg', ' · ' order by x.g desc) from (
         select l.name loc, sum(r2.remaining_g) g from rolls r2 join locations l on l.id = r2.current_location_id
         where r2.invoice_no = r.invoice_no and r2.status <> 'FINISHED' group by l.name) x) where_left
    from rolls r join fabric_items f on f.id = r.fabric_item_id left join purchase_orders p on p.po_number = r.fabric_po
    where r.invoice_no is not null group by r.invoice_no order by min(r.registered_date) desc limit 5000`)).rows as Record<string, never>[];
  const cols: Col[] = [
    { key: "inv", label: "INVOICE", kind: "mono", href: "_href" },
    { key: "pos", label: "FABRIC PO", kind: "mono", filter: true },
    { key: "vendor", label: "VENDOR", filter: true },
    { key: "fabs", label: "FABRIC #", kind: "mono" },
    { key: "first", label: "RECEIVED", kind: "date" },
    { key: "rolls", label: "ROLLS", kind: "num", total: true },
    { key: "received", label: "RECEIVED KG", kind: "kg1", total: true },
    { key: "used", label: "USED KG", kind: "kg1", total: true },
    { key: "left", label: "LEFT KG", kind: "kg1", total: true },
    { key: "where", label: "WHERE IT IS", wide: true },
  ];
  const data: Row[] = rows.map((r) => ({ _id: r.inv, _href: `/invoices/${encodeURIComponent(r.inv)}`, inv: r.inv, pos: r.pos, vendor: r.vendor, fabs: r.fabs, first: r.first,
    rolls: r.rolls, received: r.received, used: r.used, left: r.left_g, where: r.where_left ?? "all used" }));
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-4 min-w-0">
      <div><div className="h1">Invoices</div><div className="sub">Every vendor invoice: what came in on it, how much has been used, how much is left and where. Click one to see each roll.</div></div>
      <DataTable id="invoices" cols={cols} rows={data} csvName="invoices" initialQuery={q} empty="No invoices yet. Invoices are recorded when fabric is received." />
    </div>
  );
}
