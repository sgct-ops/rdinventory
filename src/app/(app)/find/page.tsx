import Link from "next/link";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { pageUser } from "@/lib/session";
import { findAnything, fabricReport } from "@/lib/posting";
import { fmtDate, fmtKg } from "@/lib/units";
import { searchAll, KIND_LABEL, type Kind } from "@/lib/search";
import { FindBox } from "@/components/FindBox";

const TONE: Record<string, string> = { ok: "bg-okbg", warn: "bg-warnbg", bad: "bg-badbg text-bad", muted: "bg-chip text-muted", info: "bg-[#eaf1fb] text-[#2459a8]" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; scope?: string }> }) {
  const u = await pageUser();
  const sp = await searchParams;
  const raw = (sp.q ?? "").trim();
  const scope = (sp.scope && sp.scope in KIND_LABEL ? sp.scope : "all") as Kind | "all";
  const plain = raw && !/^[a-z]+:|kg\s*[<>]|\b(at|in):/i.test(raw);
  const r = plain && scope === "all" ? await findAnything(raw) : raw ? { kind: "none" as const, q: raw } : null;
  if (r?.kind === "roll") redirect(`/rolls/${r.serial}`);
  if (r?.kind === "rack") redirect(`/warehouse/racks/${r.code}`);
  if (r?.kind === "to") redirect(`/log/${r.id}`);
  const fab = r?.kind === "fabric" ? await fabricReport(r.id) : null;
  const locName = new Map((await db.select().from(schema.locations)).map((l) => [l.id, l.name]));
  const sr = raw && r?.kind !== "order" ? await searchAll(raw, u.role, { per: scope === "all" ? 8 : 25, scope }) : null;
  const others = sr?.groups.map((g) => ({ ...g, hits: g.hits.filter((h) => !(fab && h.kind === "fabric" && h.id === fab.f.id)) })).filter((g) => g.hits.length) ?? [];
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-5 max-w-6xl min-w-0">
      <div><span className="pill bg-[#eaf1fb] text-[#2459a8] font-semibold">FIND</span><div className="h1 mt-2">Find</div>
        <div className="sub">Anything: a Fabric # or SKU, roll serial, rack, TO number (or just its number), customer order, fabric PO, style PO, batch or location. Press <kbd className="mono px-1 rounded border border-line">Ctrl K</kbd> anywhere for the quick finder.</div></div>
      <FindBox q={raw} scope={scope} />
      {raw && (
        <div className="flex gap-1.5 flex-wrap -mt-2">
          {(["all", "roll", "fabric", "to", "rack", "order", "po", "style", "batch", "location", "adjustment"] as const).map((k) => (
            <Link key={k} href={`/find?q=${encodeURIComponent(raw)}${k === "all" ? "" : `&scope=${k}`}`}
              className={`h-8 px-3 rounded-full text-[12.5px] border grid place-items-center ${scope === k ? "bg-ink text-white border-ink hover:text-white" : "bg-white border-line text-muted"}`}>{k === "all" ? "All" : KIND_LABEL[k]}</Link>))}
          {sr?.filters.map((f) => <span key={f} className="h-8 px-3 rounded-full text-[12.5px] bg-[#eaf1fb] text-[#2459a8] grid place-items-center">{f}</span>)}
        </div>
      )}
      {raw && !fab && r?.kind !== "order" && !others.length && <div className="card p-6 text-center"><div className="font-semibold">Nothing found for “{raw}”</div><div className="text-sm text-muted mt-1">Check the spelling, try fewer letters, or use the Fabric # instead of the SKU. Symbols and spaces don’t matter.</div></div>}
      {r?.kind === "order" && (
        <div className="card overflow-x-auto"><div className="px-4 py-3 border-b border-line"><b>Order {r.order}</b> <span className="text-muted text-sm">· {r.pieces.length} piece{r.pieces.length === 1 ? "" : "s"}</span></div>
          <table className="tbl"><thead><tr><th>TO #</th><th>DATE</th><th>STYLE PO</th><th>FABRIC #</th><th>COLOUR</th><th>ROLL SERIALS</th><th>PIECE</th><th className="text-right">KG / PIECE</th></tr></thead>
            <tbody>{r.pieces.map(({ o, t }) => (
              <tr key={o.id} className={o.reversed ? "line-through text-faint" : ""}><td><Link className="mono underline" href={`/log/${t.id}`}>{t.toNumber}</Link></td><td>{fmtDate(t.date)}</td><td className="mono text-xs">{o.stylePO}</td>
                <td className="mono">{o.fabricNo}</td><td>{o.colour}</td><td className="mono text-xs">{o.rollSerials.split(", ").map((s) => <Link key={s} className="underline mr-2" href={`/rolls/${s}`}>{s}</Link>)}</td>
                <td>{o.pieceIndex}</td><td className="text-right">{fmtKg(o.kgPerPieceG, 3)}</td></tr>))}</tbody></table></div>
      )}
      {fab && (<>
        <div className="card p-5">
          <div className="flex items-baseline gap-3 flex-wrap"><div className="text-xl font-semibold">{fab.f.fabricNo} · {fab.f.cwFabricCode} {fab.f.colour}</div>
            <div className="text-sm text-muted">{fmtKg(fab.stock.reduce((a, s) => a + s.kg, 0), 1)} kg in stock</div></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
            {[["SKU", fab.f.sku], ["Zoho item", fab.f.itemName], ["Zoho item ID", fab.f.zohoItemId], ["Group", fab.f.group], ["Unit", fab.f.unit], ["Vendor", fab.f.vendor]].map(([k, v]) =>
              v ? <div key={k}><div className="kicker">{k}</div><div className="font-medium mt-0.5 break-words">{v}</div></div> : null)}
          </div>
        </div>
        <div className="card overflow-x-auto"><div className="px-4 py-3 border-b border-line font-semibold">Stock by location</div>
          <table className="tbl"><thead><tr><th>LOCATION</th><th className="text-right">KG IN STOCK</th><th className="text-right">ROLLS</th><th className="text-right">AWAITING LABEL KG</th></tr></thead>
            <tbody>{fab.stock.map((s) => <tr key={s.location}><td>{s.location}</td><td className="text-right font-semibold">{fmtKg(s.kg, 1)}</td><td className="text-right">{s.rolls}</td><td className="text-right text-muted">{s.waiting ? fmtKg(s.waiting, 1) : ""}</td></tr>)}
              {!fab.stock.length && <tr><td colSpan={4} className="text-center text-muted py-4">No stock</td></tr>}</tbody></table></div>
        <div className="card overflow-x-auto"><div className="px-4 py-3 border-b border-line font-semibold">Last movements</div>
          <table className="tbl"><thead><tr><th>TO #</th><th>TYPE</th><th>DATE</th><th>FROM → TO</th><th>ROLL</th><th className="text-right">KG</th><th className="text-right">WASTE</th><th>STYLE PO</th></tr></thead>
            <tbody>{fab.moves.map(({ l, t, r: roll }) => (
              <tr key={l.id}><td><Link className="mono underline" href={`/log/${t.id}`}>{t.toNumber}</Link></td><td>{t.type === "TRANSFER" ? "Transfer" : "Consumption"}</td><td>{fmtDate(t.date)}</td>
                <td className="text-xs">{locName.get(t.sourceLocationId)} → {locName.get(t.destLocationId)}</td>
                <td><Link className="mono" href={`/rolls/${roll.serial}`}>{roll.serial}</Link></td><td className="text-right">{fmtKg(l.kgG)}</td><td className="text-right">{l.wasteG ? fmtKg(l.wasteG) : ""}</td><td className="mono text-xs">{t.stylePO}</td></tr>))}</tbody></table></div>
      </>)}
      {others.length > 0 && (
        <div className="flex flex-col gap-4">
          {fab && <div className="kicker">OTHER MATCHES</div>}
          <div className="grid gap-4 xl:grid-cols-2">
            {others.map((g) => (
              <div key={g.kind} className="card overflow-hidden min-w-0">
                <div className="px-4 py-2.5 border-b border-line flex items-center gap-2"><b className="text-[13.5px]">{g.label}</b><span className="text-xs text-muted">{g.hits.length}{g.more ? "+" : ""}</span>
                  {g.more && <Link className="ml-auto text-xs underline text-muted" href={`/find?q=${encodeURIComponent(raw)}&scope=${g.kind}`}>see all</Link>}</div>
                {g.hits.map((h) => (
                  <Link key={h.id} href={h.href} className="flex items-center gap-3 px-4 py-2.5 border-b border-line2 last:border-0 hover:bg-[#faf9f6] hover:text-ink min-w-0">
                    <span className="flex-1 min-w-0"><span className="flex items-center gap-2"><span className={`font-medium truncate ${["roll", "to", "batch", "po"].includes(h.kind) ? "mono" : ""}`}>{h.title}</span>
                      {h.badge && <span className={`pill text-[11px] ${TONE[h.badge.tone]}`}>{h.badge.text}</span>}</span>
                      {h.subtitle && <span className="block text-xs text-muted truncate">{h.subtitle}</span>}</span>
                    {h.meta && <span className="mono text-xs text-muted shrink-0 text-right">{h.meta}</span>}
                  </Link>))}
              </div>))}
          </div>
        </div>
      )}
    </div>
  );
}
