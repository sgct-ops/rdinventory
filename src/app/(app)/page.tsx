import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser, NAV_ROLES, type Role } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { fmtDate, fmtDateTime, fmtKg } from "@/lib/units";
import type { HealthIssue } from "@/lib/health";

type SP = { loc?: string; group?: string; sku?: string; fno?: string; q?: string; denied?: string };

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const [u, sp, s] = await Promise.all([pageUser(), searchParams, getSettings()]);
  const low = Number(s.lowStockKg) * 1000;
  const is = (r: Role[]) => r.includes(u.role);
  const like = (v?: string) => (v?.trim() ? `%${v.trim()}%` : null);
  // every query at once: the page waits for the slowest one, not the sum of all of them
  const [locs, groupRows, kRows, finderRows, byLocRows, recentRows, consRows, piecesRows, healthRows, checkRows] = await Promise.all([
    db.select().from(schema.locations).where(eq(schema.locations.active, true)).orderBy(asc(schema.locations.name)),
    db.execute(sql`select distinct coalesce(nullif(group_name,''), cw_fabric_code) g from fabric_items where active order by 1`),
    db.execute(sql`select
    (select coalesce(sum(remaining_g),0)::int from rolls where status='IN_STOCK') as kg,
    (select count(*)::int from rolls where status='IN_STOCK') as rolls,
    (select count(*)::int from rolls where status='AWAITING_LABEL') as awaiting,
    (select count(*)::int from adjustments where status='PENDING') as pending,
    (select count(*)::int from transfer_orders where not entered_in_zoho and status = 'POSTED') as not_zoho,
    (select coalesce(sum(i.pieces),0)::int from to_items i join transfer_orders t on t.id=i.to_id where t.type='CONSUMPTION' and not exists (select 1 from transfer_orders x where x.reversal_of_id=t.id) and t.date >= (now() at time zone 'Asia/Kolkata')::date - 30) as pieces,
    (select count(*)::int from rolls r where r.rack_id is null and r.taken_out_at is null and r.status <> 'FINISHED' and r.current_location_id in (select location_id from racks where active)) as unplaced`),
    db.execute(sql`
    select f.fabric_no, f.sku, coalesce(nullif(f.group_name,''), f.cw_fabric_code) grp, f.cw_fabric_code fabric, f.colour, l.name loc, sum(r.remaining_g)::int g, count(*)::int n
    from rolls r join fabric_items f on f.id=r.fabric_item_id join locations l on l.id=r.current_location_id
    where r.status='IN_STOCK'
      ${sp.loc ? sql`and l.id = ${sp.loc}` : sql``}
      ${sp.group ? sql`and coalesce(nullif(f.group_name,''), f.cw_fabric_code) = ${sp.group}` : sql``}
      ${like(sp.sku) ? sql`and f.sku ilike ${like(sp.sku)}` : sql``}
      ${like(sp.fno) ? sql`and f.fabric_no ilike ${like(sp.fno)}` : sql``}
      ${like(sp.q) ? sql`and (f.fabric_no ilike ${like(sp.q)} or f.sku ilike ${like(sp.q)} or f.group_name ilike ${like(sp.q)} or f.colour ilike ${like(sp.q)} or l.name ilike ${like(sp.q)} or f.cw_fabric_code ilike ${like(sp.q)})` : sql``}
    group by 1,2,3,4,5,6 order by 3, 1, 6`),
    db.execute(sql`select l.name loc, sum(r.remaining_g)::int g, count(*)::int n from rolls r join locations l on l.id=r.current_location_id
    where r.status='IN_STOCK' group by 1 order by 2 desc limit 10`),
    db.execute(sql`select t.id, t.to_number, t.type, t.date, s.name src, d.name dst, t.is_reversal, t.entered_in_zoho,
      (select count(*)::int from to_lines l where l.to_id=t.id) lines, (select coalesce(sum(l.kg_g + l.waste_g),0)::int from to_lines l where l.to_id=t.id) g
    from transfer_orders t join locations s on s.id=t.source_location_id join locations d on d.id=t.dest_location_id order by t.date desc, t.posted_at desc limit 10`),
    db.execute(sql`select t.style_po, l.fabric_no, f.cw_fabric_code fabric, f.colour, sum(l.kg_g)::int used, sum(l.waste_g)::int waste
    from to_lines l join transfer_orders t on t.id=l.to_id join rolls r on r.id=l.roll_id join fabric_items f on f.id=r.fabric_item_id
    where t.type='CONSUMPTION' group by 1,2,3,4 order by 1 desc, 2 limit 60`),
    db.execute(sql`select t.style_po, f.fabric_no, sum(i.pieces)::int p
    from to_items i join transfer_orders t on t.id=i.to_id join fabric_items f on f.id=i.fabric_item_id where t.type='CONSUMPTION' and not exists (select 1 from transfer_orders x where x.reversal_of_id=t.id) group by 1,2`),
    db.select().from(schema.healthReports).orderBy(desc(schema.healthReports.createdAt)).limit(1),
    db.select().from(schema.checks).orderBy(desc(schema.checks.createdAt)).limit(1),
  ]);
  const groups = groupRows.rows.map((r) => (r as { g: string }).g).filter(Boolean);
  const k = kRows.rows[0] as Record<string, number>;
  const finder = finderRows.rows as { fabric_no: string; sku: string; grp: string; fabric: string; colour: string; loc: string; g: number; n: number }[];
  const byLoc = byLocRows.rows as { loc: string; g: number; n: number }[];
  const maxLoc = Math.max(1, ...byLoc.map((x) => x.g));
  const recent = recentRows.rows as { id: string; to_number: string; type: string; date: string; src: string; dst: string; is_reversal: boolean; entered_in_zoho: boolean; lines: number; g: number }[];
  const cons = consRows.rows as { style_po: string; fabric_no: string; fabric: string; colour: string; used: number; waste: number }[];
  const piecesBy = new Map((piecesRows.rows as { style_po: string; fabric_no: string; p: number }[]).map((x) => [`${x.style_po}|${x.fabric_no}`, x.p]));
  const [health] = healthRows;
  const [check] = checkRows;
  const issues = (health?.issues as HealthIssue[] | undefined) ?? [];
  const filtered = !!(sp.loc || sp.group || sp.sku || sp.fno || sp.q);

  const tiles = [
    { show: is(NAV_ROLES.register), href: "/receive", t: "Receive fabric PO", d: "Weigh and register rolls" },
    { show: is(NAV_ROLES.activate), href: "/warehouse/put", t: "Put away", d: k.unplaced ? `${k.unplaced} waiting for a rack` : "Scan rack, then rolls", hot: k.unplaced > 0 },
    { show: is(NAV_ROLES.transfer), href: "/to/transfer", t: "Transfer order", d: "TROR · rolls moved" },
    { show: is(NAV_ROLES.consumption), href: "/to/consumption", t: "Consumption order", d: "TROC · fabric used" },
    { show: is(NAV_ROLES.activate), href: "/labels/activate", t: "Activate labels", d: k.awaiting ? `${k.awaiting} awaiting a label scan` : "Scan labels elsewhere", hot: k.awaiting > 0 },
    { show: is(NAV_ROLES.adjust), href: "/adjustments/new", t: "Adjust a roll", d: "Re-weigh, damage, found" },
    { show: true, href: "/find", t: "Find", d: "Fabric, roll, TO, order" },
    { show: is(NAV_ROLES.activate), href: "/warehouse/count", t: "Count a rack", d: "Weekly rack count" },
  ].filter((x) => x.show);
  const kpi = (label: string, v: string | number, cap: string, href?: string, amber?: boolean) => {
    const on = amber && Number(v) > 0;
    const body = <><div className={`text-[10px] font-bold tracking-wider border-t-[3px] pt-2 ${amber ? "border-warn text-muted" : "border-ok text-muted"}`}>{label}</div>
      <div className={`text-2xl font-bold mt-1 ${on ? "text-amber-700" : ""}`}>{v}</div><div className="text-[11px] text-muted">{cap}</div></>;
    return href ? <Link href={href} className={`rounded-xl p-4 ${on ? "bg-warnbg" : "bg-[#f4f7f5]"} hover:brightness-95`}>{body}</Link> : <div className="rounded-xl p-4 bg-[#f4f7f5]">{body}</div>;
  };

  return (
    <div className="p-4 lg:p-7 flex flex-col gap-6">
      {sp.denied && <div className="text-sm bg-badbg text-bad rounded-md px-3 py-2">Your role can&apos;t open that page.</div>}
      <div className="flex items-end gap-3 flex-wrap">
        <div><div className="text-[26px] font-bold">Fabric Inventory</div><div className="sub">Source of truth for fabric · Carbonwork is the check</div></div>
        <div className="ml-auto text-xs text-muted">Hello {u.name ?? u.email} · {u.role.toLowerCase()}</div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
        {tiles.map((x) => (
          <Link key={x.href} href={x.href} className={`rounded-2xl border p-4 min-h-[96px] flex flex-col justify-between active:scale-[.98] transition ${x.hot ? "bg-ink text-white border-ink" : "bg-white border-line hover:border-ink"}`}>
            <div className="font-semibold text-[15px] leading-tight">{x.t}</div><div className={`text-xs ${x.hot ? "text-white/80" : "text-muted"}`}>{x.d}</div>
          </Link>))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpi("KG IN STOCK", fmtKg(k.kg, 1), "labelled rolls, all locations")}
        {kpi("ROLLS IN STOCK", k.rolls, "on the shelf or at a factory", "/rolls?status=IN_STOCK")}
        {kpi("AWAITING LABEL", k.awaiting, "print, stick and scan to activate", "/labels/activate", true)}
        {kpi("PENDING ADJUSTMENTS", k.pending, "Admin to approve or reject", u.role === "ADMIN" ? "/adjustments" : undefined, true)}
        {kpi("TOs NOT IN ZOHO YET", k.not_zoho, "make them in Zoho, then tick", "/log?zoho=no", true)}
        {kpi("PIECES MADE · 30 DAYS", k.pieces, "from consumption orders")}
      </div>

      {issues.filter((i) => i.severity === "red").length > 0 && (
        <div className="card p-4 border-bad"><div className="font-semibold text-bad mb-1">Health check found problems ({fmtDateTime(health!.createdAt)})</div>
          {issues.filter((i) => i.severity === "red").slice(0, 10).map((i, n) => <div key={n} className="text-sm">{i.text}</div>)}</div>)}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-6">
        <div className="flex flex-col gap-3 min-w-0">
          <form className="rounded-xl bg-[#f4f7f5] p-4 flex flex-col gap-3">
            <div className="flex items-baseline gap-3 flex-wrap"><div className="font-bold">Find fabric</div><div className="text-xs text-muted">Leave a box empty for all. SKU, Fabric # and Search match part of the text.</div></div>
            <div className="grid grid-cols-2 md:grid-cols-[1.2fr_1.2fr_1fr_1fr_1.4fr_auto] gap-2">
              <select name="loc" defaultValue={sp.loc ?? ""} className="input"><option value="">All locations</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
              <select name="group" defaultValue={sp.group ?? ""} className="input"><option value="">All groups</option>{groups.map((g) => <option key={g}>{g}</option>)}</select>
              <input name="sku" defaultValue={sp.sku} className="input" placeholder="SKU" />
              <input name="fno" defaultValue={sp.fno} className="input" placeholder="Fabric #" />
              <input name="q" defaultValue={sp.q} className="input col-span-2 md:col-span-1" placeholder="Search (colour, anything)" />
              <div className="flex gap-2 col-span-2 md:col-span-1"><button className="btn flex-1">Show</button>{filtered && <Link href="/" className="btn-ghost">Clear</Link>}</div>
            </div>
            <div className="text-xs font-semibold text-ok">{finder.length ? `Showing ${finder.length} rows · ${fmtKg(finder.reduce((a, r) => a + r.g, 0), 1)} kg · ${finder.reduce((a, r) => a + r.n, 0)} rolls` : "No stock matches these filters"}</div>
          </form>
          <div className="card overflow-x-auto max-h-[620px]"><table className="tbl">
            <thead className="sticky top-0 bg-[#eef2ef]"><tr><th>FABRIC #</th><th>SKU</th><th>GROUP</th><th>FABRIC</th><th>COLOUR</th><th>LOCATION</th><th className="text-right">KG</th><th className="text-right">ROLLS</th></tr></thead>
            <tbody>{finder.map((r, i) => (
              <tr key={i}><td className="font-bold mono"><Link href={`/find?q=${encodeURIComponent(r.fabric_no)}`}>{r.fabric_no}</Link></td><td className="text-xs mono">{r.sku}</td><td>{r.grp}</td><td>{r.fabric}</td><td>{r.colour}</td><td>{r.loc}</td>
                <td className={`text-right font-semibold ${r.g < low ? "bg-warnbg text-amber-700" : ""}`}>{fmtKg(r.g, 1)}</td><td className="text-right">{r.n}</td></tr>))}</tbody></table></div>
        </div>

        <div className="flex flex-col gap-6 min-w-0">
          <div className="card overflow-hidden"><div className="px-4 py-3 border-b border-line font-bold">Stock by location</div>
            <table className="tbl"><thead><tr><th>LOCATION</th><th className="text-right">KG</th><th className="text-right">ROLLS</th><th>SHARE OF STOCK</th></tr></thead>
              <tbody>{byLoc.map((x) => <tr key={x.loc}><td className="font-bold">{x.loc}</td><td className="text-right">{fmtKg(x.g, 1)}</td><td className="text-right">{x.n}</td>
                <td className="w-2/5"><div className="h-2.5 bg-line2 rounded"><div className="h-full bg-ok rounded" style={{ width: `${(x.g / maxLoc) * 100}%` }} /></div></td></tr>)}
                {!byLoc.length && <tr><td colSpan={4} className="text-center text-muted py-4">No stock yet</td></tr>}</tbody></table></div>

          <div className="card overflow-hidden"><div className="px-4 py-3 border-b border-line font-bold">Recent postings</div>
            <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>TO #</th><th>TYPE</th><th>DATE</th><th>FROM → TO</th><th className="text-right">LINES</th><th className="text-right">KG</th><th>ZOHO</th></tr></thead>
              <tbody>{recent.map((t) => (
                <tr key={t.id} className={t.is_reversal ? "text-muted italic" : ""}><td className="font-bold mono"><Link href={`/log/${t.id}`}>{t.to_number}</Link></td>
                  <td><span className={`pill ${t.type === "TRANSFER" ? "bg-[#eaf1fb] text-[#2459a8]" : "bg-warnbg text-amber-800"}`}>{t.type === "TRANSFER" ? "Transfer" : "Consumption"}</span></td>
                  <td className="whitespace-nowrap">{fmtDate(t.date)}</td><td className="text-xs">{t.src} → {t.dst}</td><td className="text-right">{t.lines}</td>
                  <td className={`text-right ${t.g < 0 ? "text-bad" : ""}`}>{fmtKg(t.g, 1)}</td><td>{t.entered_in_zoho ? "✓" : <span className="text-accent">—</span>}</td></tr>))}
                {!recent.length && <tr><td colSpan={7} className="text-center text-muted py-4">No postings yet</td></tr>}</tbody></table></div></div>

          <div className="card overflow-hidden"><div className="px-4 py-3 border-b border-line font-bold">Consumption by style PO and fabric</div>
            <div className="overflow-x-auto max-h-80"><table className="tbl"><thead><tr><th>STYLE PO</th><th>FABRIC #</th><th>FABRIC</th><th>COLOUR</th><th className="text-right">KG USED</th><th className="text-right">WASTE</th><th className="text-right">PIECES</th></tr></thead>
              <tbody>{cons.map((c, i) => (
                <tr key={i}><td className="font-bold mono text-xs"><Link href={`/log?q=${encodeURIComponent(c.style_po)}`}>{c.style_po}</Link></td><td className="mono">{c.fabric_no}</td><td>{c.fabric}</td><td>{c.colour}</td>
                  <td className="text-right">{fmtKg(c.used, 1)}</td><td className="text-right text-muted">{fmtKg(c.waste, 1)}</td><td className="text-right">{piecesBy.get(`${c.style_po}|${c.fabric_no}`) || ""}</td></tr>))}
                {!cons.length && <tr><td colSpan={7} className="text-center text-muted py-4">No consumption yet</td></tr>}</tbody></table></div></div>

          <div className="card p-4 text-sm"><div className="font-bold mb-1">Gap against Carbonwork</div>
            {check ? <Link href={`/check/${check.id}`} className="underline decoration-line">{check.fileName}: {check.rowsFlagged} of {check.rowsChecked} rows flagged</Link> : <span className="text-muted">No check run yet.</span>}</div>
        </div>
      </div>
    </div>
  );
}
