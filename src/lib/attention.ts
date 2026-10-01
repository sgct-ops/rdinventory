import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { NAV_ROLES, type Role } from "@/lib/session";
import type { Attention } from "@/components/Nav";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What is waiting for this person. Shown under the bell. One cheap query. */
export async function attentionFor(role: Role, opts: { samples?: boolean } = {}): Promise<{ items: Attention[]; zoho: number; labels: number; unplaced: number; pending: number; picks: number }> {
  const c = (await db.execute(sql`select
      (select count(*)::int from adjustments where status='PENDING') as pending,
      (select count(*)::int from rolls where label_activated_at is null and status <> 'FINISHED') as labels,
      (select count(*)::int from rolls r where r.rack_id is null and r.taken_out_at is null and r.status <> 'FINISHED'
         and r.current_location_id in (select location_id from racks where active)) as unplaced,
      (select count(*)::int from transfer_orders where not entered_in_zoho and status = 'POSTED') as zoho,
      (select count(*)::int from transfer_orders where not entered_in_zoho and status = 'POSTED' and posted_at < now() - interval '2 days') as zoho_old,
      (select count(*)::int from transfer_orders where status = 'PLANNED') as picks,
      (select count(*)::int from rolls where taken_out_at is not null and taken_out_purpose <> 'TROR' and status <> 'FINISHED'
         and taken_out_at < now() - make_interval(days => coalesce((select value::int from settings where key = 'takeOutAlertDays'), 3))) as out_long,
      (select count(*)::int from racks where active and (last_counted_at is null or last_counted_at < now() - interval '7 days')) as overdue,
      (select coalesce((select jsonb_array_length(coalesce((select jsonb_agg(x) from jsonb_array_elements(issues) x where x->>'severity'='red'), '[]'::jsonb))
         from health_reports order by created_at desc limit 1), 0))::int as red`)).rows[0] as Record<string, number>;
  const is = (r: Role[]) => r.includes(role);
  const items: Attention[] = [];
  if (is(NAV_ROLES.approve) && c.red) items.push({ href: "/admin/tools", n: c.red, tone: "bad", icon: "alert", text: plural(c.red, "health check problem", "health check problems"), detail: "From this morning's check: a balance doesn't match its logs" });
  if (is(NAV_ROLES.approve) && c.pending) items.push({ href: "/adjustments", n: c.pending, tone: "bad", icon: "check", text: plural(c.pending, "adjustment to approve", "adjustments to approve"), detail: "Above the approval limit, waiting for you" });
  if (is(NAV_ROLES.activate) && c.unplaced) items.push({ href: "/warehouse/put", n: c.unplaced, tone: "warn", icon: "rack", text: plural(c.unplaced, "roll to put away", "rolls to put away"), detail: "At Rajdanga Storage but not on a rack yet" });
  if ((is(NAV_ROLES.labels) || is(NAV_ROLES.activate)) && c.labels) items.push({ href: is(NAV_ROLES.labels) ? "/labels" : "/labels/activate", n: c.labels, tone: "warn", icon: "tag", text: plural(c.labels, "label to print or scan in", "labels to print or scan in"), detail: "Stock only counts once its label is scanned" });
  if (is(NAV_ROLES.pick) && c.picks) items.push({ href: "/to/pick", n: c.picks, tone: "warn", icon: "truck", text: plural(c.picks, "TROR to pick", "TRORs to pick"), detail: "Made in the office, waiting for the warehouse to scan the rolls" });
  if (is(NAV_ROLES.takeOut) && c.out_long) items.push({ href: "/warehouse/takeout", n: c.out_long, tone: "warn", icon: "takeout", text: plural(c.out_long, "roll out too long", "rolls out too long"), detail: "Taken out for production or sampling, no TROC yet" });
  if (is(NAV_ROLES.activate) && c.overdue) items.push({ href: "/warehouse/counts", n: c.overdue, tone: "warn", icon: "count", text: plural(c.overdue, "rack due for a count", "racks due for a count"), detail: "Not counted in the last 7 days" });
  if (is(NAV_ROLES.log) && c.zoho) items.push({ href: "/zoho?q=ALL", n: c.zoho, tone: c.zoho_old ? "warn" : "quiet", icon: "zoho", text: plural(c.zoho, "TO not in Zoho yet", "TOs not in Zoho yet"), detail: c.zoho_old ? `${c.zoho_old} older than 2 days` : "Make the Zoho prompt when ready" });
  if (opts.samples && items.length) await addSamples(items);
  return { items, zoho: c.zoho, labels: c.labels, unplaced: c.unplaced, pending: c.pending, picks: c.picks };
}

const kg = (g: number) => `${(g / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
const ago = (d: string | Date | null) => {
  if (!d) return "never";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};

/** The first few things behind each count, and the button that deals with them. Only for the open panel. */
async function addSamples(items: Attention[]) {
  const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  await Promise.all(items.map(async (a) => {
    if (a.icon === "alert") {
      const [h] = await rows(sql`select issues from health_reports order by created_at desc limit 1`);
      a.samples = ((h?.issues ?? []) as { severity: string; text: string; ref?: string }[]).filter((i) => i.severity === "red").slice(0, 4)
        .map((i) => ({ label: i.text, href: i.ref ? `/find?q=${encodeURIComponent(i.ref)}` : "/admin/tools" }));
      a.action = "Open health check";
    } else if (a.icon === "check") {
      a.samples = (await rows(sql`select a.number, a.kg_change_g, a.reason, a.requested_by, r.serial from adjustments a join rolls r on r.id = a.roll_id
          where a.status = 'PENDING' order by a.requested_at limit 4`))
        .map((x) => ({ label: x.serial, sub: `${x.kg_change_g > 0 ? "+" : ""}${kg(x.kg_change_g)} · ${String(x.reason).toLowerCase()} · by ${String(x.requested_by).split("@")[0]}`, href: "/adjustments" }));
      a.action = "Review and approve";
    } else if (a.icon === "rack") {
      a.samples = (await rows(sql`select r.serial, r.remaining_g, f.fabric_no from rolls r join fabric_items f on f.id = r.fabric_item_id
          where r.rack_id is null and r.taken_out_at is null and r.status <> 'FINISHED' and r.current_location_id in (select location_id from racks where active) order by r.created_at limit 4`))
        .map((x) => ({ label: x.serial, sub: `${x.fabric_no} · ${kg(x.remaining_g)}`, href: `/rolls/${x.serial}` }));
      a.action = "Start putting away";
    } else if (a.icon === "tag") {
      a.samples = (await rows(sql`select r.serial, r.remaining_g, r.label_printed_at, l.name loc from rolls r join locations l on l.id = r.current_location_id
          where r.label_activated_at is null and r.status <> 'FINISHED' order by r.created_at limit 4`))
        .map((x) => ({ label: x.serial, sub: `${x.label_printed_at ? "printed, not scanned" : "not printed"} · ${x.loc}`, href: `/rolls/${x.serial}` }));
      a.action = a.href === "/labels" ? "Print labels" : "Scan labels in";
    } else if (a.icon === "count") {
      a.samples = (await rows(sql`select code, room, last_counted_at from racks where active and (last_counted_at is null or last_counted_at < now() - interval '7 days')
          order by last_counted_at nulls first, code limit 4`))
        .map((x) => ({ label: `Rack ${x.code}`, sub: `${x.room} · last counted ${ago(x.last_counted_at)}`, href: `/warehouse/count?rack=${x.code}` }));
      a.action = "Count a rack";
    } else if (a.icon === "truck") {
      a.samples = (await rows(sql`select t.id, t.to_number, l.name dest, t.planned_at from transfer_orders t join locations l on l.id = t.dest_location_id where t.status = 'PLANNED' order by t.planned_at limit 4`))
        .map((x) => ({ label: x.to_number, sub: `to ${x.dest} · planned ${ago(x.planned_at)}`, href: `/to/pick/${x.id}` }));
      a.action = "Pick a TROR";
    } else if (a.icon === "takeout") {
      a.samples = (await rows(sql`select serial, taken_out_for, taken_out_purpose, taken_out_at from rolls where taken_out_at is not null and taken_out_purpose <> 'TROR' and status <> 'FINISHED' order by taken_out_at limit 4`))
        .map((x) => ({ label: x.serial, sub: `${String(x.taken_out_purpose).toLowerCase()}${x.taken_out_for ? ` · ${x.taken_out_for}` : ""} · ${ago(x.taken_out_at)}`, href: `/rolls/${x.serial}` }));
      a.action = "Open take-outs";
    } else if (a.icon === "zoho") {
      a.samples = (await rows(sql`select id, to_number, date, posted_at from transfer_orders where not entered_in_zoho and status = 'POSTED' order by posted_at limit 4`))
        .map((x) => ({ label: x.to_number, sub: `posted ${ago(x.posted_at)}`, href: `/log/${x.id}` }));
      a.action = "Make the Zoho prompt";
    }
  }));
}
