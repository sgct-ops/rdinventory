import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { pageUser } from "@/lib/session";
import { fmtKg } from "@/lib/units";
import { DataTable, type Col, type Row } from "@/components/DataTable";

export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  await pageUser();
  const inv = decodeURIComponent((await params).no).toUpperCase();
  const rolls = (await db.execute(sql`
    select r.serial, r.weighed_g, r.consumed_g, r.adjusted_g, r.split_g, r.remaining_g, r.status, r.registered_date, r.fabric_po, r.split_from_id, r.taken_out_for,
      f.fabric_no, f.item_name, f.colour, b.code batch, l.name loc, k.code rack, p.serial parent
    from rolls r join fabric_items f on f.id = r.fabric_item_id join batches b on b.id = r.batch_id join locations l on l.id = r.current_location_id
      left join racks k on k.id = r.rack_id left join rolls p on p.id = r.split_from_id
    where upper(r.invoice_no) = ${inv} order by r.registered_date, r.serial`)).rows as Record<string, never>[];
  const uses = (await db.execute(sql`
    select t.id, t.to_number, t.type, t.date, t.style_po, s.name src, d.name dst, x.kg_g, x.waste_g, r.serial
    from to_lines x join rolls r on r.id = x.roll_id join transfer_orders t on t.id = x.to_id
      join locations s on s.id = t.source_location_id join locations d on d.id = t.dest_location_id
    where upper(r.invoice_no) = ${inv} order by t.posted_at`)).rows as Record<string, never>[];
  const [rc] = (await db.execute(sql`select string_agg(number || ' (' || date || ')', ', ') r, string_agg(distinct po_number, ', ') po from receipts where upper(invoice_no) = ${inv}`)).rows as { r: string | null; po: string | null }[];
  const recv = rolls.filter((r) => !r.split_from_id).reduce((a, r) => a + (r.weighed_g as number), 0);
  const used = rolls.reduce((a, r) => a + (r.consumed_g as number), 0);
  const left = rolls.filter((r) => r.status !== "FINISHED").reduce((a, r) => a + (r.remaining_g as number), 0);
  const rcols: Col[] = [
    { key: "serial", label: "ROLL", kind: "mono", href: "_href", sub: "cut" },
    { key: "fabric", label: "FABRIC", wide: true }, { key: "batch", label: "BATCH", kind: "mono" },
    { key: "weighed", label: "WEIGHED", kind: "kg", total: true }, { key: "used", label: "USED", kind: "kg", total: true },
    { key: "left", label: "LEFT", kind: "kg", total: true }, { key: "loc", label: "LOCATION", filter: true }, { key: "rack", label: "RACK", kind: "mono" },
    { key: "status", label: "STATUS", kind: "pill", tone: "tone", filter: true },
  ];
  const rrows: Row[] = rolls.map((r) => ({ _id: r.serial, _href: `/rolls/${r.serial}`, serial: r.serial, cut: r.parent ? `cut from ${r.parent}` : "", fabric: `${r.fabric_no} · ${r.item_name}${r.colour ? ` · ${r.colour}` : ""}`,
    batch: r.batch, weighed: r.weighed_g, used: r.consumed_g, left: r.remaining_g, loc: r.loc, rack: r.rack ?? (r.taken_out_for ? `out · ${r.taken_out_for}` : ""),
    status: r.status === "FINISHED" ? "Finished" : r.status === "IN_STOCK" ? "In stock" : "Awaiting label", tone: r.status === "FINISHED" ? "muted" : r.status === "IN_STOCK" ? "ok" : "warn" }));
  const ucols: Col[] = [
    { key: "to", label: "TO #", kind: "mono", href: "_href" }, { key: "type", label: "TYPE", kind: "pill", tone: "tone", filter: true }, { key: "date", label: "DATE", kind: "date" },
    { key: "route", label: "FROM → TO" }, { key: "po", label: "STYLE PO", kind: "mono", filter: true }, { key: "roll", label: "ROLL", kind: "mono" },
    { key: "kg", label: "KG", kind: "kg", total: true }, { key: "waste", label: "WASTE", kind: "kg", total: true },
  ];
  const urows: Row[] = uses.map((u, i) => ({ _id: `${u.id}-${i}`, _href: `/log/${u.id}`, to: u.to_number, type: u.type === "TRANSFER" ? "Transfer" : "Consumption", tone: u.type === "TRANSFER" ? "info" : "warn",
    date: u.date, route: `${u.src} → ${u.dst}`, po: u.style_po, roll: u.serial, kg: u.kg_g, waste: u.waste_g || null }));
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-4 min-w-0">
      <div><Link href="/invoices" className="text-sm text-muted">← Invoices</Link><div className="h1 mono mt-1">{inv}</div>
        <div className="sub">{rc?.po ? `Fabric PO ${rc.po}` : ""}{rc?.r ? ` · receipts ${rc.r}` : ""}</div></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[["ROLLS", String(rolls.filter((r) => !r.split_from_id).length)], ["RECEIVED", `${fmtKg(recv, 1)} kg`], ["USED", `${fmtKg(used, 1)} kg`], ["LEFT", `${fmtKg(left, 1)} kg`]].map(([k, v]) => (
          <div key={k} className="card p-4"><div className="kicker">{k}</div><div className="text-2xl font-semibold mt-1">{v}</div></div>))}
      </div>
      <div className="font-semibold">Rolls on this invoice</div>
      <DataTable id="invoice-rolls" cols={rcols} rows={rrows} csvName={`invoice-${inv}`} empty="No rolls on this invoice." />
      <div className="font-semibold">Where it was used and sent</div>
      <DataTable id="invoice-uses" cols={ucols} rows={urows} csvName={`invoice-${inv}-moves`} empty="Nothing used or moved yet." />
    </div>
  );
}
