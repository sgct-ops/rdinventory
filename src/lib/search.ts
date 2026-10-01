/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { NAV_ROLES, type Role } from "@/lib/session";

/**
 * One search over everything in the app. Used by the Ctrl K finder and the Find page.
 *
 * - Ignores case, spaces and symbols:  "ct26po48" finds CT26/PO/48, "55a 4821" finds 55A-4821.
 * - Exact matches first, then "starts with", then "contains".
 * - Narrow it with a prefix:  roll: fab: to: rack: order: (or #)  po: style: batch: loc: adj:
 * - Roll filters you can add:  kg>20  kg<5  at:Exim  in:stock | in:awaiting | in:finished
 */
export type Kind = "fabric" | "roll" | "rack" | "to" | "order" | "po" | "style" | "batch" | "location" | "adjustment";
export type Hit = {
  kind: Kind; id: string; title: string; subtitle?: string; meta?: string; href: string;
  badge?: { text: string; tone: "ok" | "warn" | "bad" | "muted" | "info" };
  detail?: [string, string][]; exact?: boolean;
};
export type SearchResult = { q: string; scope: Kind | "all"; filters: string[]; groups: { kind: Kind; label: string; hits: Hit[]; more: boolean }[]; exact?: Hit; ms: number };

export const KIND_LABEL: Record<Kind, string> = {
  fabric: "Fabrics", roll: "Rolls", rack: "Racks", to: "Transfer orders", order: "Customer orders",
  po: "Fabric POs", style: "Style POs", batch: "Batches", location: "Locations", adjustment: "Adjustments",
};
const PREFIX: Record<string, Kind> = {
  roll: "roll", rolls: "roll", serial: "roll", fab: "fabric", fabric: "fabric", sku: "fabric", to: "to", tro: "to", tror: "to", troc: "to",
  rack: "rack", order: "order", po: "po", style: "style", batch: "batch", loc: "location", location: "location", adj: "adjustment",
};
const KG = (g: number) => (g / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 });
const date = (d: string | Date | null) => { if (!d) return ""; const s = d instanceof Date ? d.toISOString() : String(d); const [y, m, x] = s.slice(0, 10).split("-"); return `${x}-${m}-${y}`; };

export function parseQuery(raw: string) {
  let q = raw.trim();
  let scope: Kind | "all" = "all";
  const roll: { min?: number; max?: number; at?: string; status?: string } = {};
  const filters: string[] = [];
  q = q.replace(/\bkg\s*([<>]=?)\s*(\d+(?:\.\d+)?)/gi, (_, op: string, n: string) => {
    const g = Math.round(Number(n) * 1000); if (op.startsWith(">")) roll.min = g; else roll.max = g; filters.push(`kg ${op} ${n}`); return " ";
  });
  q = q.replace(/\bat:("[^"]+"|\S+)/gi, (_, v: string) => { roll.at = v.replace(/"/g, ""); filters.push(`at ${roll.at}`); return " "; });
  q = q.replace(/\bin:(stock|awaiting|finished)\b/gi, (_, v: string) => { roll.status = v.toLowerCase(); filters.push(`in ${roll.status}`); return " "; });
  const m = q.match(/^\s*([a-z]+):\s*(.*)$/i);
  if (m && PREFIX[m[1].toLowerCase()]) { scope = PREFIX[m[1].toLowerCase()]; q = m[2]; }
  if (q.trim().startsWith("#") && scope === "all") scope = "order";
  if (roll.min !== undefined || roll.max !== undefined || roll.at || roll.status) { if (scope === "all") scope = "roll"; }
  q = q.replace(/\s+/g, " ").trim();
  return { q, scope, roll, filters };
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
/** rank: 0 exact, 1 starts with, 2 contains (on the normalised text) */
const rank = (col: SQL, n: string) => sql`case when ${col} = ${n} then 0 when ${col} like ${n + "%"} then 1 else 2 end`;
const N = (col: SQL) => sql`regexp_replace(upper(coalesce(${col}, '')), '[^A-Z0-9]', '', 'g')`;

export async function searchAll(raw: string, role: Role, opts: { per?: number; scope?: Kind | "all" } = {}): Promise<SearchResult> {
  const t0 = Date.now();
  const p = parseQuery(raw);
  const scope = opts.scope && opts.scope !== "all" ? opts.scope : p.scope;
  const per = opts.per ?? 6;
  const lim = per + 1;
  const n = norm(p.q);
  const like = `%${n}%`;
  const canLog = NAV_ROLES.log.includes(role);
  const want = (k: Kind) => scope === "all" || scope === k;
  const hasRollFilter = p.roll.min !== undefined || p.roll.max !== undefined || !!p.roll.at || !!p.roll.status;
  if (!n && !hasRollFilter) return { q: p.q, scope, filters: p.filters, groups: [], ms: 0 };

  const jobs: Promise<{ kind: Kind; hits: Hit[] }>[] = [];
  const run = (kind: Kind, f: () => Promise<Hit[]>) => jobs.push(f().then((hits) => ({ kind, hits })).catch((e) => { console.error("search", kind, e); return { kind, hits: [] }; }));

  if (want("fabric") && n) run("fabric", async () => {
    const rows = (await db.execute(sql`
      select f.id, f.fabric_no, f.sku, f.item_name, f.colour, f.cw_fabric_code, f.group_name,
        coalesce(sum(r.remaining_g) filter (where r.status='IN_STOCK'),0)::int kg,
        count(r.id) filter (where r.status='IN_STOCK')::int rolls,
        coalesce(sum(r.remaining_g) filter (where r.status='AWAITING_LABEL'),0)::int waiting,
        least(${rank(N(sql`f.fabric_no`), n)}, ${rank(N(sql`f.sku`), n)}, ${rank(N(sql`f.cw_fabric_code`), n)} + 1, 3) rk
      from fabric_items f left join rolls r on r.fabric_item_id = f.id
      where ${N(sql`f.fabric_no`)} like ${like} or ${N(sql`f.sku`)} like ${like} or ${N(sql`f.item_name`)} like ${like}
         or ${N(sql`f.colour`)} like ${like} or ${N(sql`f.cw_fabric_code`)} like ${like} or ${N(sql`f.group_name`)} like ${like}
         or ${N(sql`f.zoho_item_id`)} = ${n}
      group by f.id order by rk, kg desc, f.fabric_no limit ${lim}`)).rows as any[];
    return rows.map((r) => ({
      kind: "fabric", id: r.id, href: `/find?q=${encodeURIComponent(r.fabric_no ?? r.sku ?? "")}`, exact: r.rk === 0,
      title: `${r.fabric_no ?? "—"}  ${r.item_name}`, subtitle: [r.colour, r.sku, r.cw_fabric_code && `CW ${r.cw_fabric_code}`].filter(Boolean).join(" · "),
      meta: `${KG(r.kg)} kg · ${r.rolls} roll${r.rolls === 1 ? "" : "s"}`,
      badge: r.kg ? undefined : { text: "no stock", tone: "muted" },
      detail: [["Fabric #", r.fabric_no ?? ""], ["SKU", r.sku ?? ""], ["Colour", r.colour ?? ""], ["Group", r.group_name ?? ""], ["Carbonwork", r.cw_fabric_code ?? ""],
        ["In stock", `${KG(r.kg)} kg in ${r.rolls} rolls`], ...(r.waiting ? [["Awaiting label", `${KG(r.waiting)} kg`] as [string, string]] : [])],
    }));
  });

  if (want("roll")) run("roll", async () => {
    const w: SQL[] = [];
    if (n) w.push(sql`(${N(sql`r.serial`)} like ${like} or (${scope === "roll"} and (${N(sql`f.fabric_no`)} like ${like} or ${N(sql`r.fabric_po`)} like ${like} or ${N(sql`b.code`)} like ${like})))`);
    if (p.roll.min !== undefined) w.push(sql`r.remaining_g >= ${p.roll.min}`);
    if (p.roll.max !== undefined) w.push(sql`r.remaining_g <= ${p.roll.max}`);
    if (p.roll.at) w.push(sql`(upper(l.name) like ${"%" + p.roll.at.toUpperCase() + "%"} or upper(l.code) = ${p.roll.at.toUpperCase()} or upper(k.code) = ${p.roll.at.toUpperCase().replace(/^RK-/, "")})`);
    if (p.roll.status === "stock") w.push(sql`r.status = 'IN_STOCK'`);
    else if (p.roll.status === "awaiting") w.push(sql`r.status = 'AWAITING_LABEL'`);
    else if (p.roll.status === "finished") w.push(sql`r.status = 'FINISHED'`);
    else if (hasRollFilter) w.push(sql`r.status <> 'FINISHED'`);
    const rows = (await db.execute(sql`
      select r.id, r.serial, r.remaining_g, r.weighed_g, r.status, r.label_activated_at, r.fabric_po, r.registered_date, r.split_from_id,
        f.fabric_no, f.item_name, f.colour, b.code batch, l.name loc, k.code rack, ${n ? rank(N(sql`r.serial`), n) : sql`2`} rk
      from rolls r join fabric_items f on f.id = r.fabric_item_id join batches b on b.id = r.batch_id
        join locations l on l.id = r.current_location_id left join racks k on k.id = r.rack_id
      where ${sql.join(w, sql` and `)}
      order by rk, (r.status = 'FINISHED'), r.created_at desc limit ${hasRollFilter ? Math.max(lim, 26) : lim}`)).rows as any[];
    return rows.map((r) => ({
      kind: "roll", id: r.id, href: `/rolls/${r.serial}`, exact: r.rk === 0,
      title: r.serial, subtitle: `${r.fabric_no} · ${r.item_name}${r.colour ? ` ${r.colour}` : ""}`,
      meta: `${KG(r.remaining_g)} kg · ${r.loc}${r.rack ? ` · ${r.rack}` : ""}`,
      badge: r.status === "FINISHED" ? { text: "finished", tone: "muted" } : r.status === "AWAITING_LABEL" || !r.label_activated_at ? { text: "label to scan", tone: "warn" } : !r.rack && r.loc === "Rajdanga Storage" ? { text: "unplaced", tone: "warn" } : { text: "in stock", tone: "ok" },
      detail: [["Left", `${KG(r.remaining_g)} of ${KG(r.weighed_g)} kg`], ["Location", r.loc], ["Rack", r.rack ?? "—"], ["Batch", r.batch], ["Fabric PO", r.fabric_po ?? ""], ["Registered", date(r.registered_date)], ...(r.split_from_id ? [["Note", "cut piece"] as [string, string]] : [])],
    }));
  });

  if (want("rack") && n) run("rack", async () => {
    const rows = (await db.execute(sql`
      select k.code, k.room, k.capacity, k.last_counted_at, count(r.id)::int n, coalesce(sum(r.remaining_g),0)::int g, ${rank(N(sql`k.code`), n.replace(/^RK/, ""))} rk
      from racks k left join rolls r on r.rack_id = k.id and r.status <> 'FINISHED'
      where k.active and (${N(sql`k.code`)} like ${"%" + n.replace(/^RK/, "") + "%"} or ${N(sql`k.room`)} like ${like})
      group by k.id order by rk, k.code limit ${lim}`)).rows as any[];
    return rows.map((r) => ({
      kind: "rack", id: r.code, href: `/warehouse/racks/${r.code}`, exact: r.rk === 0, title: `Rack ${r.code}`, subtitle: r.room,
      meta: `${r.n} rolls · ${KG(r.g)} kg`, badge: r.n >= r.capacity ? { text: "full", tone: "bad" } : undefined,
      detail: [["Room", r.room], ["Rolls", `${r.n} of ${r.capacity}`], ["Kg", KG(r.g)], ["Last count", r.last_counted_at ? date(r.last_counted_at) : "never"]],
    }));
  });

  if (want("to") && canLog && n) run("to", async () => {
    const num = /^\d+$/.test(n) ? String(Number(n)) : null;
    const rows = (await db.execute(sql`
      select t.id, t.to_number, t.type, t.date, t.style_po, t.mo_number, t.tax_invoice_no, t.is_reversal, t.entered_in_zoho, t.pieces_made, t.posted_by,
        s.name src, d.name dst, coalesce((select sum(kg_g) from to_lines x where x.to_id = t.id),0)::int g,
        (select count(*) from to_lines x where x.to_id = t.id)::int lines,
        case when ${N(sql`t.to_number`)} = ${n} or regexp_replace(t.to_number, '^TRO[CR]-0*', '') = ${num ?? "-"} then 0 when ${N(sql`t.to_number`)} like ${n + "%"} then 1 else 2 end rk
      from transfer_orders t join locations s on s.id = t.source_location_id join locations d on d.id = t.dest_location_id
      where ${N(sql`t.to_number`)} like ${like} or regexp_replace(t.to_number, '^TRO[CR]-0*', '') = ${num ?? "-"}
         or ${N(sql`t.style_po`)} like ${like} or ${N(sql`t.mo_number`)} like ${like} or ${N(sql`t.tax_invoice_no`)} like ${like}
      order by rk, t.posted_at desc limit ${lim}`)).rows as any[];
    return rows.map((r) => ({
      kind: "to", id: r.id, href: `/log/${r.id}`, exact: r.rk === 0, title: r.to_number,
      subtitle: `${r.type === "TRANSFER" ? "Transfer" : "Consumption"} · ${r.src} → ${r.dst}`, meta: `${KG(r.g)} kg · ${date(r.date)}`,
      badge: r.is_reversal ? { text: "reversal", tone: "muted" } : !r.entered_in_zoho ? { text: "not in Zoho", tone: "warn" } : { text: "in Zoho", tone: "ok" },
      detail: [["Date", date(r.date)], ["From", r.src], ["To", r.dst], ["Kg", KG(r.g)], ["Lines", String(r.lines)], ...(r.style_po ? [["Style PO", r.style_po] as [string, string]] : []),
        ...(r.pieces_made ? [["Pieces", String(r.pieces_made)] as [string, string]] : []), ...(r.mo_number ? [["MO #", r.mo_number] as [string, string]] : []), ["Posted by", r.posted_by]],
    }));
  });

  if (want("order") && canLog && n) run("order", async () => {
    const rows = (await db.execute(sql`
      select upper(o.order_number) ord, count(*)::int pieces, count(*) filter (where o.reversed)::int rev, string_agg(distinct t.to_number, ', ') tos,
        string_agg(distinct o.style_po, ', ') styles, string_agg(distinct o.fabric_no, ', ') fabs, min(${rank(N(sql`o.order_number`), n)}) rk
      from order_links o join transfer_orders t on t.id = o.to_id
      where ${N(sql`o.order_number`)} like ${like} group by upper(o.order_number) order by rk, ord limit ${lim}`)).rows as any[];
    return rows.map((r) => ({
      kind: "order", id: r.ord, href: `/find?q=${encodeURIComponent(r.ord)}`, exact: r.rk === 0, title: `Order ${r.ord}`,
      subtitle: `${r.pieces} piece${r.pieces === 1 ? "" : "s"} · ${r.styles}`, meta: r.tos, badge: r.rev ? { text: `${r.rev} reversed`, tone: "muted" } : undefined,
      detail: [["Pieces", String(r.pieces)], ["Style PO", r.styles], ["Fabric #", r.fabs], ["TOs", r.tos]],
    }));
  });

  if (want("po") && n) run("po", async () => {
    const rows = (await db.execute(sql`
      select r.fabric_po po, count(*)::int n, coalesce(sum(r.remaining_g) filter (where r.status <> 'FINISHED'),0)::int g, coalesce(sum(r.weighed_g),0)::int w,
        string_agg(distinct f.fabric_no, ', ') fabs, min(r.registered_date) first, min(${rank(N(sql`r.fabric_po`), n)}) rk
      from rolls r join fabric_items f on f.id = r.fabric_item_id
      where ${N(sql`r.fabric_po`)} like ${like} group by r.fabric_po order by rk, first desc limit ${lim}`)).rows as any[];
    return rows.map((r) => ({
      kind: "po", id: r.po, href: `/rolls?all=1&q=${encodeURIComponent(r.po)}`, exact: r.rk === 0, title: r.po, subtitle: `Fabric PO · ${r.fabs}`,
      meta: `${r.n} rolls · ${KG(r.g)} kg left`, detail: [["Received", `${KG(r.w)} kg in ${r.n} rolls`], ["Left", `${KG(r.g)} kg`], ["Fabric #", r.fabs], ["First received", date(r.first)]],
    }));
  });

  if (want("style") && canLog && n) run("style", async () => {
    const rows = (await db.execute(sql`
      select t.style_po sp, count(distinct t.id)::int tos, coalesce(sum(x.kg_g),0)::int g, coalesce(sum(x.waste_g),0)::int w, coalesce(sum(distinct t.pieces_made),0)::int pcs, min(${rank(N(sql`t.style_po`), n)}) rk
      from transfer_orders t left join to_lines x on x.to_id = t.id
      where t.style_po is not null and ${N(sql`t.style_po`)} like ${like} group by t.style_po order by rk, sp limit ${lim}`)).rows as any[];
    return rows.map((r) => ({
      kind: "style", id: r.sp, href: `/log?q=${encodeURIComponent(r.sp)}`, exact: r.rk === 0, title: r.sp, subtitle: "Style PO",
      meta: `${r.tos} TO${r.tos === 1 ? "" : "s"} · ${KG(r.g)} kg used`, detail: [["Consumption orders", String(r.tos)], ["Kg used", KG(r.g)], ["Waste", `${KG(r.w)} kg`]],
    }));
  });

  if (want("batch") && n) run("batch", async () => {
    const rows = (await db.execute(sql`
      select b.code, f.fabric_no, count(r.id)::int n, coalesce(sum(r.remaining_g) filter (where r.status <> 'FINISHED'),0)::int g, ${rank(N(sql`b.code`), n)} rk
      from batches b join fabric_items f on f.id = b.fabric_item_id left join rolls r on r.batch_id = b.id
      where ${N(sql`b.code`)} like ${like} group by b.id, f.fabric_no order by rk, b.code desc limit ${lim}`)).rows as any[];
    return rows.map((r) => ({ kind: "batch", id: r.code, href: `/rolls?all=1&q=${encodeURIComponent(r.code)}`, exact: r.rk === 0, title: r.code, subtitle: `Batch · Fabric # ${r.fabric_no}`, meta: `${r.n} rolls · ${KG(r.g)} kg left` }));
  });

  if (want("location") && n) run("location", async () => {
    const rows = (await db.execute(sql`
      select l.id, l.name, l.type, count(r.id)::int n, coalesce(sum(r.remaining_g),0)::int g, ${rank(N(sql`l.name`), n)} rk
      from locations l left join rolls r on r.current_location_id = l.id and r.status = 'IN_STOCK'
      where l.active and (${N(sql`l.name`)} like ${like} or ${N(sql`l.code`)} like ${like} or ${N(sql`l.carbonwork_name`)} like ${like})
      group by l.id order by rk, g desc limit ${lim}`)).rows as any[];
    return rows.map((r) => ({ kind: "location", id: r.id, href: `/rolls?q=${encodeURIComponent(r.name)}`, exact: r.rk === 0, title: r.name, subtitle: r.type.charAt(0) + r.type.slice(1).toLowerCase(), meta: `${r.n} rolls · ${KG(r.g)} kg` }));
  });

  if (want("adjustment") && n && role !== "VIEWER") run("adjustment", async () => {
    const rows = (await db.execute(sql`
      select a.number, a.kg_change_g, a.status, a.reason, r.serial, ${rank(N(sql`a.number`), n)} rk
      from adjustments a join rolls r on r.id = a.roll_id where ${N(sql`a.number`)} like ${like} order by rk, a.requested_at desc limit ${lim}`)).rows as any[];
    return rows.map((r) => ({ kind: "adjustment", id: r.number, href: `/adjustments/list?q=${encodeURIComponent(r.number)}`, exact: r.rk === 0, title: r.number,
      subtitle: `${r.serial} · ${r.reason.toLowerCase()}`, meta: `${r.kg_change_g > 0 ? "+" : ""}${KG(r.kg_change_g)} kg`, badge: { text: r.status.toLowerCase(), tone: r.status === "APPROVED" ? "ok" : r.status === "PENDING" ? "warn" : "bad" } }));
  });

  const out = await Promise.all(jobs);
  const order: Kind[] = ["roll", "to", "rack", "order", "fabric", "batch", "po", "style", "location", "adjustment"];
  // exact matches float their group to the top
  const groups = out.filter((g) => g.hits.length)
    .sort((a, b) => (Number(!a.hits[0]?.exact) - Number(!b.hits[0]?.exact)) || order.indexOf(a.kind) - order.indexOf(b.kind))
    .map((g) => ({ kind: g.kind, label: KIND_LABEL[g.kind], hits: g.hits.slice(0, hasRollFilter && g.kind === "roll" ? 25 : per), more: g.hits.length > per && !(hasRollFilter && g.kind === "roll") }));
  const exacts = groups.flatMap((g) => g.hits.filter((h) => h.exact && ["roll", "to", "rack"].includes(h.kind)));
  return { q: p.q, scope, filters: p.filters, groups, exact: exacts.length === 1 ? exacts[0] : undefined, ms: Date.now() - t0 };
}
