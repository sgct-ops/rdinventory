import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser } from "@/lib/session";
import { fabricHex } from "@/lib/warehouse";
import { fmtDateTime, fmtKg } from "@/lib/units";
import { getSettings } from "@/lib/settings";

export default async function Page({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ f?: string }> }) {
  const u = await pageUser();
  const { code } = await params; const { f } = await searchParams;
  const [rack] = await db.select().from(schema.racks).where(eq(schema.racks.code, decodeURIComponent(code).toUpperCase()));
  if (!rack) notFound();
  const s = await getSettings();
  const rows = await db.select({ r: schema.rolls, f: schema.fabricItems, b: schema.batches }).from(schema.rolls)
    .innerJoin(schema.fabricItems, eq(schema.fabricItems.id, schema.rolls.fabricItemId))
    .innerJoin(schema.batches, eq(schema.batches.id, schema.rolls.batchId))
    .where(eq(schema.rolls.rackId, rack.id)).orderBy(schema.fabricItems.itemName, schema.rolls.serial);
  const [lastCount] = await db.select().from(schema.rackCounts).where(and(eq(schema.rackCounts.rackId, rack.id), isNotNull(schema.rackCounts.finishedAt)))
    .orderBy(desc(schema.rackCounts.finishedAt)).limit(1);
  const n = rows.length, kgG = rows.reduce((a, x) => a + x.r.remainingG, 0), pct = Math.round((n / rack.capacity) * 100);
  const groups = [...rows.reduce((m, x) => m.set(x.f.id, { label: x.f.colour ?? x.f.itemName, count: (m.get(x.f.id)?.count ?? 0) + 1 }), new Map<string, { label: string; count: number }>())];
  const shown = rows.filter((x) => !f || x.f.id === f);
  const canWork = ["ADMIN", "INVENTORY"].includes(u.role);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-6 p-5 lg:p-7">
      <div className="flex flex-col gap-4">
        <div className="text-[13px] text-muted"><Link href="/warehouse" className="underline">Map</Link> / {rack.building} / {rack.room}</div>
        <div className="mono text-[40px] leading-none font-semibold">{rack.code}</div>
        <div className="card p-4 flex flex-col gap-2.5">
          <div className="kicker">RACK LABEL</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/barcode?text=RK-${rack.code}`} alt={`RK-${rack.code}`} className="h-12 w-full object-contain" />
          <div className="mono text-[13px] font-semibold text-center">RK-{rack.code}</div>
          {u.role === "ADMIN" && <a className="text-xs underline text-center text-muted" href={`/api/labels/racks?codes=${rack.code}`} target="_blank">Print rack label</a>}
        </div>
        <div className="card p-4 flex flex-col gap-3 text-[13px]">
          <div className="flex justify-between"><div className="text-muted">Rolls</div><div className="font-semibold">{n} of {rack.capacity}</div></div>
          <div className="h-2 bg-[#efece6] rounded"><div className="h-full rounded" style={{ width: `${Math.min(pct, 100)}%`, background: pct >= Number(s.rackFullPct) ? "oklch(0.8 0.13 80)" : "#1c1b19" }} /></div>
          <div className="flex justify-between"><div className="text-muted">Kg on rack</div><div className="font-semibold">{fmtKg(kgG, 1)}</div></div>
          <div className="flex justify-between"><div className="text-muted">Last counted</div><div className="font-semibold">{lastCount ? `${fmtDateTime(lastCount.finishedAt)} · ${lastCount.gaps} gaps` : "never"}</div></div>
        </div>
        {canWork && <div className="flex flex-col gap-2">
          <Link href={`/warehouse/count?rack=${rack.code}`} className="btn">Count this rack</Link>
          <Link href={`/warehouse/move?from=${rack.code}`} className="btn-ghost">Move rolls from here</Link>
        </div>}
      </div>
      <div className="card flex flex-col min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3.5 border-b border-line text-xs flex-wrap">
          <Link href={`/warehouse/racks/${rack.code}`} className={`px-2.5 py-1 rounded-full border ${!f ? "bg-ink text-white border-ink" : "bg-white border-line"}`}>All {n}</Link>
          {groups.map(([id, g]) => <Link key={id} href={`/warehouse/racks/${rack.code}?f=${id}`} className={`px-2.5 py-1 rounded-full border ${f === id ? "bg-ink text-white border-ink" : "bg-white border-line"}`}>{g.label} {g.count}</Link>)}
        </div>
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>SERIAL</th><th>FABRIC · COLOUR</th><th>BATCH</th><th className="text-right">WEIGHED</th><th className="text-right">LEFT KG</th><th>STATUS</th><th>SINCE</th></tr></thead>
          <tbody>{shown.map(({ r, f: fb, b }) => (
            <tr key={r.id}>
              <td><Link href={`/rolls/${r.serial}`} className="mono font-medium">{r.serial}</Link></td>
              <td><div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full border border-black/20 flex-none" style={{ background: fabricHex(fb.hex, fb.colour, fb.id) }} />{fb.itemName}{fb.colour ? ` · ${fb.colour}` : ""}</div></td>
              <td className="mono text-xs text-muted">{b.code}</td><td className="text-right text-muted">{fmtKg(r.weighedG, 1)}</td><td className="text-right font-semibold">{fmtKg(r.remainingG, 1)}</td>
              <td><span className={`pill ${r.missingSince ? "bg-badbg" : r.consumedG || r.adjustedG ? "bg-warnbg" : "bg-okbg"}`}>{r.missingSince ? "Missing at count" : r.consumedG ? "Part used" : "In stock"}</span></td>
              <td className="text-muted">{fmtDateTime(r.rackSince)}</td></tr>))}
            {!shown.length && <tr><td colSpan={7} className="text-center text-muted py-6">Empty rack</td></tr>}</tbody></table></div>
      </div>
    </div>
  );
}
