import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser, NAV_ROLES } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { fmtDate, fmtDateTime, fmtKg } from "@/lib/units";
import { ReverseTOButton, ZohoTick } from "@/components/Buttons";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const u = await pageUser(NAV_ROLES.log);
  const { id } = await params;
  const [t] = await db.select().from(schema.transferOrders).where(eq(schema.transferOrders.id, id));
  if (!t) notFound();
  const locs = new Map((await db.select().from(schema.locations)).map((l) => [l.id, l.name]));
  const lines = await db.select({ l: schema.toLines, r: schema.rolls }).from(schema.toLines).innerJoin(schema.rolls, eq(schema.rolls.id, schema.toLines.rollId)).where(eq(schema.toLines.toId, t.id));
  const orders = await db.select().from(schema.orderLinks).where(eq(schema.orderLinks.toId, t.id)).orderBy(schema.orderLinks.itemRow, schema.orderLinks.pieceIndex);
  const [rev] = await db.select().from(schema.transferOrders).where(eq(schema.transferOrders.reversalOfId, t.id));
  const orig = t.reversalOfId ? (await db.select().from(schema.transferOrders).where(eq(schema.transferOrders.id, t.reversalOfId)))[0] : undefined;
  const s = await getSettings();
  const mins = (Date.now() - t.postedAt.getTime()) / 60000;
  const canUndo = !t.isReversal && !rev && mins <= Number(s.undoMinutes) && t.postedBy === u.email && u.role !== "VIEWER";
  const canReverse = !t.isReversal && !rev && u.role === "ADMIN";
  return (
    <div className="p-5 lg:p-7 flex flex-col gap-5 max-w-6xl">
      <div className="flex items-center gap-4 flex-wrap">
        <div><div className="text-[13px] text-muted"><Link href="/log" className="underline">TO Log</Link> / {t.type === "TRANSFER" ? "Transfer" : "Consumption"}</div>
          <div className="mono text-[32px] font-semibold">{t.toNumber}</div></div>
        {rev && <Link href={`/log/${rev.id}`} className="pill bg-badbg">Reversed by {rev.toNumber}</Link>}
        {orig && <Link href={`/log/${orig.id}`} className="pill bg-chip">Reversal of {orig.toNumber}</Link>}
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm"><ZohoTick id={t.id} value={t.enteredInZoho} disabled={u.role === "VIEWER"} /> Entered in Zoho</label>
          <Link className="btn-ghost btn-sm" href={`/zoho?q=${t.toNumber}`}>Zoho prompt</Link>
          <ReverseTOButton toNumber={t.toNumber} canUndo={canUndo} canReverse={canReverse} />
        </div>
      </div>
      <div className="card grid grid-cols-2 md:grid-cols-4">
        {[["Date", fmtDate(t.date)], ["Source", locs.get(t.sourceLocationId)], ["Destination", locs.get(t.destLocationId)], ["Destination address", t.destAddress],
          ["Reason", t.reason], ["Style PO", t.stylePO], ["MO number", t.moNumber], ["Tax invoice", t.taxInvoiceNo],
          ["Posted", `${t.postedBy} · ${fmtDateTime(t.postedAt)}`], ["Zoho", t.enteredInZoho ? `${t.enteredInZohoBy} · ${fmtDateTime(t.enteredInZohoAt)}` : "not yet"],
          ["Pieces made", t.piecesMade ?? ""], ["Reversal reason", t.reversalReason ?? ""]]
          .map(([k, v]) => <div key={String(k)} className="px-4 py-3 border-b border-r border-line2"><div className="text-xs text-muted">{k}</div><div className="text-sm mt-0.5">{v || "—"}</div></div>)}
        {t.attachmentsUrl && /^https?:\/\//.test(t.attachmentsUrl) && <div className="px-4 py-3"><a className="underline text-sm" href={t.attachmentsUrl} target="_blank" rel="noreferrer">Attachments</a></div>}
      </div>
      <div className="card overflow-x-auto"><table className="tbl">
        <thead><tr><th>ROW</th><th>ROLL</th><th>RACK</th><th>BATCH</th><th>FABRIC #</th><th className="text-right">SOURCE STOCK</th><th className="text-right">DEST STOCK</th><th className="text-right">ROLL KG</th><th className="text-right">{t.type === "TRANSFER" ? "TRANSFER KG" : "KG USED"}</th><th className="text-right">WASTE</th></tr></thead>
        <tbody>{lines.map(({ l, r }) => (
          <tr key={l.id}><td>{l.itemRow}</td><td><Link className="mono" href={`/rolls/${r.serial}`}>{r.serial}</Link>{l.cutFromSerial && <div className="text-[11px] text-muted">cut from {l.cutFromSerial}</div>}</td><td className="mono text-xs">{l.rackCode}</td><td className="mono text-xs">{l.batchCode}</td><td className="mono">{l.fabricNo}</td>
            <td className="text-right text-muted">{fmtKg(l.sourceBeforeG)} → {fmtKg(l.sourceAfterG)}</td>
            <td className="text-right text-muted">{t.type === "TRANSFER" ? `${fmtKg(l.destBeforeG)} → ${fmtKg(l.destAfterG)}` : ""}</td>
            <td className="text-right text-muted">{fmtKg(l.rollBeforeG)} → {fmtKg(l.rollAfterG)}</td>
            <td className="text-right font-semibold">{fmtKg(l.kgG)}</td><td className="text-right">{l.wasteG ? fmtKg(l.wasteG) : ""}</td></tr>))}</tbody></table></div>
      {orders.length > 0 && (
        <div className="card p-4"><div className="font-semibold mb-2">Pieces and order numbers ({orders.length})</div>
          {[...new Set(orders.map((o) => o.itemRow))].map((row) => { const first = orders.find((o) => o.itemRow === row)!; return (<div key={row} className="mb-2"><div className="text-xs text-muted mb-1">Row {row} · {first.fabricNo} {first.colour} · {fmtKg(first.kgPerPieceG, 3)} kg per piece</div>
          <div className="flex flex-wrap gap-2">{orders.filter((o) => o.itemRow === row).map((o) => <Link key={o.id} href={`/find?q=${encodeURIComponent(o.orderNumber)}`} className={`mono text-sm px-2 py-1 rounded bg-paper ${o.reversed ? "line-through text-faint" : ""}`}>{o.pieceIndex}. {o.orderNumber}</Link>)}</div></div>); })}</div>
      )}
    </div>
  );
}
