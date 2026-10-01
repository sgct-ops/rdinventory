import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser, type Role } from "@/lib/session";
import { toCsv } from "@/lib/csv";

const KINDS: Record<string, { roles: Role[]; q: (p: URLSearchParams) => ReturnType<typeof sql> }> = {
  rolls: { roles: ["ADMIN", "INVENTORY", "MERCHANDISER", "VIEWER"], q: (p) => sql`
    select r.serial as "Roll serial", b.code as "Batch", f.fabric_no as "Rajdanga Fabric #", f.zoho_item_id as "Zoho item", f.cw_fabric_code as "Fabric code", f.colour as "Colour",
      f.sku as "SKU", coalesce(nullif(f.group_name,''), f.cw_fabric_code) as "Fabric group", r.fabric_po as "Fabric PO", r.registered_date as "Registered date", rl.name as "Registered at", r.weighed_g/1000.0 as "Weighed kg", r.weighed_by as "Weighed by",
      (r.label_printed_at is not null) as "Label printed", l.name as "Current location", k.code as "Rack", r.consumed_g/1000.0 as "Consumed kg", r.adjusted_g/1000.0 as "Adjusted kg",
      r.split_g/1000.0 as "Split kg", r.remaining_g/1000.0 as "Remaining kg", r.status as "Status", (select s.serial from rolls s where s.id=r.split_from_id) as "Split from", r.last_movement as "Last movement", r.notes as "Notes"
    from rolls r join batches b on b.id=r.batch_id join fabric_items f on f.id=r.fabric_item_id join locations l on l.id=r.current_location_id
    join locations rl on rl.id=r.registered_location_id left join racks k on k.id=r.rack_id
    where true ${p.get("loc") ? sql`and r.current_location_id = ${p.get("loc")}` : sql``} ${p.get("status") ? sql`and r.status = ${p.get("status")}` : sql``}
    order by r.created_at` },
  tolog: { roles: ["ADMIN", "INVENTORY", "MERCHANDISER"], q: (p) => sql`
    select t.to_number as "TO #", t.type as "Type", t.date as "Date", s.name as "Source", d.name as "Destination", r.serial as "Roll serial", l.batch_code as "Batch",
      l.fabric_no as "Rajdanga Fabric #", l.item_row as "Item row", l.kg_g/1000.0 as "Kg", l.waste_g/1000.0 as "Waste kg", t.style_po as "Style PO", t.mo_number as "MO number",
      t.tax_invoice_no as "Tax invoice number", t.reason as "Reason", l.cut_from_serial as "Cut from", l.rack_code as "Rack", t.posted_by as "Posted by", t.posted_at as "Posted at", t.entered_in_zoho as "Entered in Zoho",
      (select o.to_number from transfer_orders o where o.id=t.reversal_of_id) as "Reversal of"
    from to_lines l join transfer_orders t on t.id=l.to_id join rolls r on r.id=l.roll_id join locations s on s.id=t.source_location_id join locations d on d.id=t.dest_location_id
    where true ${p.get("type") ? sql`and t.type = ${p.get("type")}` : sql``} ${p.get("zoho") === "no" ? sql`and not t.entered_in_zoho` : sql``}
    order by t.posted_at` },
  orders: { roles: ["ADMIN", "INVENTORY", "MERCHANDISER"], q: () => sql`
    select t.to_number as "TO #", t.date as "Date", o.style_po as "Style PO", o.roll_serials as "Roll serials", o.order_number as "Order number", o.piece_index as "Piece #",
      o.kg_per_piece_g/1000.0 as "Kg per piece", t.posted_by as "Posted by", t.posted_at as "Posted at", o.fabric_no as "Rajdanga Fabric #", o.colour as "Colour", o.item_row as "Item row", o.reversed as "Reversed"
    from order_links o join transfer_orders t on t.id=o.to_id order by t.posted_at, o.piece_index` },
  adjustments: { roles: ["ADMIN", "INVENTORY", "MERCHANDISER"], q: () => sql`
    select a.number, r.serial, a.kg_change_g/1000.0 as kg_change, a.reason, a.note, a.status, a.requested_by, a.requested_at, a.decided_by, a.decided_at, a.roll_before_g/1000.0 as roll_before_kg, a.roll_after_g/1000.0 as roll_after_kg
    from adjustments a join rolls r on r.id=a.roll_id order by a.requested_at` },
  audit: { roles: ["ADMIN"], q: () => sql`select at, user_email, action, entity, entity_id, roll_serials, kg_before_g/1000.0 as kg_before, kg_after_g/1000.0 as kg_after, details::text from audit order by at` },
  movements: { roles: ["ADMIN", "INVENTORY", "MERCHANDISER", "VIEWER"], q: () => sql`select at, serial, from_label, to_label, via, ref, by, note from rack_moves order by at` },
};

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const k = KINDS[kind];
  const u = await getCurrentUser();
  if (!k) return new Response("Unknown export", { status: 404 });
  if (!u || !k.roles.includes(u.role)) return new Response("Forbidden", { status: 403 });
  const rows = (await db.execute(k.q(new URL(req.url).searchParams))).rows as Record<string, unknown>[];
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${kind}-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
