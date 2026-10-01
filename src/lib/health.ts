import "server-only";
import { sql } from "drizzle-orm";
import { gzipSync } from "zlib";
import { db, schema } from "@/db";

export type HealthIssue = { kind: string; severity: "red" | "amber"; text: string; ref?: string };

async function q<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const r = await db.execute(query);
  return r.rows as T[];
}

/** 8 am check: negative kg, labels waiting > 3 days, pending adjustments, TOs not in Zoho after 2 days,
 * and a full re-derivation of every roll from the ledger so a bug can never silently drift the numbers. */
export async function runHealthCheck() {
  const issues: HealthIssue[] = [];

  for (const r of await q<{ serial: string; remaining_g: number }>(sql`select serial, remaining_g from rolls where remaining_g < 0`))
    issues.push({ kind: "negative", severity: "red", text: `${r.serial} is below 0 kg (${r.remaining_g / 1000} kg)`, ref: r.serial });

  for (const r of await q<{ serial: string; days: number; printed: boolean }>(sql`
    select serial, extract(day from now() - created_at)::int as days, (label_printed_at is not null) as printed
    from rolls where label_activated_at is null and status <> 'FINISHED' and created_at < now() - interval '3 days'`))
    issues.push({ kind: "label", severity: "amber", text: `${r.serial}: label ${r.printed ? "printed but not scanned" : "not printed"} for ${r.days} days`, ref: r.serial });

  const [p] = await q<{ n: number }>(sql`select count(*)::int as n from adjustments where status = 'PENDING'`);
  if (p?.n) issues.push({ kind: "pending", severity: "amber", text: `${p.n} adjustment(s) waiting for approval` });

  for (const r of await q<{ to_number: string }>(sql`
    select to_number from transfer_orders where entered_in_zoho = false and posted_at < now() - interval '2 days' order by posted_at`))
    issues.push({ kind: "zoho", severity: "amber", text: `${r.to_number} not ticked "Entered in Zoho" after 2 days`, ref: r.to_number });

  // Ledger re-derivation
  for (const r of await q<{ serial: string; stored: number; derived: number }>(sql`
    select r.serial, r.remaining_g as stored,
      r.weighed_g - coalesce(c.g,0) + coalesce(a.g,0) - coalesce(sp.g,0) as derived
    from rolls r
    left join (select l.roll_id, sum(l.kg_g + l.waste_g) g from to_lines l join transfer_orders t on t.id = l.to_id
               where t.type = 'CONSUMPTION' group by l.roll_id) c on c.roll_id = r.id
    left join (select roll_id, sum(kg_change_g) g from adjustments where status = 'APPROVED' group by roll_id) a on a.roll_id = r.id
    left join (select split_from_id, sum(weighed_g) g from rolls where split_from_id is not null group by split_from_id) sp on sp.split_from_id = r.id
    where r.remaining_g <> r.weighed_g - coalesce(c.g,0) + coalesce(a.g,0) - coalesce(sp.g,0)`))
    issues.push({ kind: "ledger", severity: "red", text: `${r.serial}: stored ${r.stored / 1000} kg but ledger says ${r.derived / 1000} kg`, ref: r.serial });

  for (const r of await q<{ serial: string }>(sql`
    select r.serial from rolls r
    join lateral (select t.dest_location_id from to_lines l join transfer_orders t on t.id = l.to_id
                  where l.roll_id = r.id and t.type = 'TRANSFER' order by t.posted_at desc limit 1) last on true
    where last.dest_location_id <> r.current_location_id`))
    issues.push({ kind: "ledger", severity: "red", text: `${r.serial}: current location doesn't match its latest Transfer TO`, ref: r.serial });

  const [row] = await db.insert(schema.healthReports).values({ issues }).returning();
  return row;
}

const TABLES = [
  "locations", "fabric_items", "users", "user_locations", "batches", "rolls", "serial_registry", "to_items",
  "transfer_orders", "to_lines", "order_links", "adjustments", "audit", "carbonwork_checks", "spot_weighs", "settings", "counters", "racks", "rack_moves", "rack_counts",
];

/** 11 pm backup: every table as gzipped JSON, kept for 60 days. */
export async function runBackup() {
  const dump: Record<string, unknown[]> = { _meta: [{ at: new Date().toISOString(), version: 1 }] };
  for (const t of TABLES) dump[t] = (await db.execute(sql.raw(`select * from "${t}"`))).rows;
  const data = gzipSync(Buffer.from(JSON.stringify(dump)));
  const [b] = await db.insert(schema.backups).values({ sizeBytes: data.length, data }).returning({ id: schema.backups.id });
  await db.execute(sql`delete from backups where created_at < now() - interval '60 days'`);
  return { id: b.id, sizeBytes: data.length };
}
