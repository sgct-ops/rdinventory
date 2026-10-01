import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser } from "@/lib/session";
import { fabricHex } from "@/lib/warehouse";
import { fmtDate, fmtDateTime, fmtKg } from "@/lib/units";

const ST: Record<string, [string, string]> = { AWAITING_LABEL: ["Awaiting label", "bg-warnbg"], IN_STOCK: ["In stock", "bg-okbg"], FINISHED: ["Finished", "bg-chip"] };

export default async function Page({ params }: { params: Promise<{ serial: string }> }) {
  const u = await pageUser();
  const serial = decodeURIComponent((await params).serial).toUpperCase();
  const [row] = await db.select({ r: schema.rolls, f: schema.fabricItems, b: schema.batches, l: schema.locations }).from(schema.rolls)
    .innerJoin(schema.fabricItems, eq(schema.fabricItems.id, schema.rolls.fabricItemId))
    .innerJoin(schema.batches, eq(schema.batches.id, schema.rolls.batchId))
    .innerJoin(schema.locations, eq(schema.locations.id, schema.rolls.currentLocationId))
    .where(eq(schema.rolls.serial, serial));
  if (!row) notFound();
  const { r, f, b, l } = row;
  const racks = await db.select().from(schema.racks).where(eq(schema.racks.locationId, l.id)).orderBy(asc(schema.racks.sortOrder), asc(schema.racks.code));
  const rack = racks.find((x) => x.id === r.rackId);
  const lastRack = r.lastRackId ? (await db.select().from(schema.racks).where(eq(schema.racks.id, r.lastRackId)))[0] : undefined;
  const lines = await db.select({ l: schema.toLines, t: schema.transferOrders }).from(schema.toLines)
    .innerJoin(schema.transferOrders, eq(schema.transferOrders.id, schema.toLines.toId)).where(eq(schema.toLines.rollId, r.id));
  const adjs = await db.select().from(schema.adjustments).where(eq(schema.adjustments.rollId, r.id));
  const moves = await db.select().from(schema.rackMoves).where(eq(schema.rackMoves.rollId, r.id));
  const audits = await db.select().from(schema.audit).where(eq(schema.audit.entityId, r.id)).orderBy(desc(schema.audit.at));
  const locNames = new Map((await db.select().from(schema.locations)).map((x) => [x.id, x.name]));
  const cutFrom = r.splitFromId ? (await db.select({ s: schema.rolls.serial }).from(schema.rolls).where(eq(schema.rolls.id, r.splitFromId)))[0]?.s : undefined;
  const pieces = await db.select({ s: schema.rolls.serial, g: schema.rolls.weighedG }).from(schema.rolls).where(eq(schema.rolls.splitFromId, r.id));

  type H = { at: Date; t: string; d: string; dot: string; href?: string };
  const hist: H[] = [
    ...pieces.map((pc) => ({ at: r.createdAt, t: `Cut piece ${pc.s} · ${fmtKg(pc.g, 1)} kg`, d: "cut off this roll on a transfer", dot: "oklch(0.8 0.13 80)", href: `/rolls/${pc.s}` })),
    { at: r.createdAt, t: r.splitFromId ? `Cut piece · ${fmtKg(r.weighedG, 1)} kg from ${cutFrom}` : `Received on ${r.fabricPO} · weighed ${fmtKg(r.weighedG, 1)} kg`, d: `${locNames.get(r.registeredLocationId)} · ${r.weighedBy}`, dot: "#1c1b19" },
    ...audits.filter((a) => a.action.startsWith("LABEL_")).map((a) => ({ at: a.at, t: a.action === "LABEL_ACTIVATED" ? "Label activated · In stock" : a.action === "LABEL_REPRINTED" ? "Label reprinted" : "Label printed", d: a.userEmail, dot: "#bdb8ae" })),
    ...lines.map(({ l: x, t }) => ({
      at: t.postedAt, href: `/log/${t.id}`, dot: t.type === "TRANSFER" ? "oklch(0.6 0.16 45)" : "#1c1b19",
      t: t.type === "TRANSFER" ? `${t.toNumber} · moved ${locNames.get(t.sourceLocationId)} → ${locNames.get(t.destLocationId)}`
        : `${t.toNumber} · ${x.kgG < 0 ? "reversed " : ""}${fmtKg(Math.abs(x.kgG), 1)} kg used${x.wasteG ? ` + ${fmtKg(Math.abs(x.wasteG), 1)} waste` : ""} on ${t.stylePO}`,
      d: `${fmtDate(t.date)} · ${fmtKg(x.rollBeforeG, 1)} → ${fmtKg(x.rollAfterG, 1)} kg · ${t.postedBy}${t.isReversal ? " · reversal" : ""}`,
    })),
    ...adjs.map((a) => ({ at: a.decidedAt ?? a.requestedAt, dot: a.status === "APPROVED" ? "oklch(0.62 0.12 150)" : a.status === "PENDING" ? "oklch(0.8 0.13 80)" : "#bdb8ae",
      t: `${a.number} · adjustment ${a.kgChangeG > 0 ? "+" : ""}${fmtKg(a.kgChangeG, 2)} kg · ${a.status.toLowerCase()}`, d: `${a.reason.replaceAll("_", " ").toLowerCase()}${a.note ? " · " + a.note : ""} · ${a.requestedBy}` })),
    ...moves.map((m) => ({ at: m.at, t: `${m.fromLabel} → ${m.toLabel}`, d: `${m.via}${m.ref ? " · " + m.ref : ""} · ${m.note ?? ""} · ${m.by}`, dot: "oklch(0.62 0.12 150)" })),
  ].sort((a, c) => c.at.getTime() - a.at.getTime());

  const hex = fabricHex(f.hex, f.colour, f.id);
  const leftPct = (r.remainingG / r.weighedG) * 100;
  const where = rack ? rack.code : racks.length ? (r.status === "FINISHED" ? "—" : "Unplaced") : l.name;
  const whereSub = rack ? `${rack.room} · ${rack.building} · ${l.name}` : racks.length ? (r.offRackReason === "RETURNED" && lastRack ? `back from ${r.offRackRef} · left ${lastRack.code}` : `at ${l.name}, waiting for a rack`)
    : lastRack ? `left ${lastRack.code} on ${r.offRackRef}` : "no racks at this location";
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6 p-5 lg:p-7">
      <div className="flex flex-col gap-5 min-w-0">
        <div className="flex gap-5 items-center">
          <div className="w-[84px] h-[84px] rounded-full border border-black/15 flex-none" style={{ background: hex, boxShadow: "inset 0 0 0 16px rgba(255,255,255,.14), inset 0 0 0 30px rgba(0,0,0,.06)" }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap"><div className="mono text-[30px] font-semibold">{r.serial}</div>
              <div className={`pill ${ST[r.status][1]}`}>{r.missingSince ? "Missing at count" : ST[r.status][0]}</div></div>
            <div className="text-[15px] text-muted mt-1">{f.itemName}{f.colour ? ` · ${f.colour}` : ""} · Rajdanga Fabric # {f.fabricNo}</div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card p-4.5 p-[18px] flex flex-col gap-2.5">
            <div className="kicker">LOCATION</div>
            <div className="flex items-baseline gap-2.5 flex-wrap"><div className="mono text-[28px] font-semibold">{where}</div><div className="text-[13px] text-muted">{whereSub}</div></div>
            {racks.length > 0 && <div className="flex gap-1 mt-1">{racks.map((k) => (
              <div key={k.id} className="flex-1 min-w-0 overflow-hidden h-[26px] mono text-[10px] font-semibold leading-[22px] text-center"
                style={{ border: k.id === r.rackId ? "2px solid oklch(0.6 0.16 45)" : "1.5px solid #d6d2c9", background: k.id === r.rackId ? "oklch(0.93 0.05 50)" : "#fff", color: k.id === r.rackId ? "#1c1b19" : "#9a968d" }}>{k.code}</div>))}</div>}
          </div>
          <div className="card p-[18px] flex flex-col gap-2.5">
            <div className="kicker">KG</div>
            <div className="flex items-baseline gap-2.5"><div className="text-[30px] font-semibold">{fmtKg(r.remainingG, 1)}</div><div className="text-[13px] text-muted">left of {fmtKg(r.weighedG, 1)} weighed</div></div>
            <div className="h-2.5 bg-[#efece6] rounded overflow-hidden"><div className="h-full bg-ink" style={{ width: `${Math.max(0, Math.min(100, leftPct))}%` }} /></div>
            <div className="text-xs text-muted">Weighed − consumed ({fmtKg(r.consumedG, 1)}) {r.adjustedG >= 0 ? "+" : "−"} adjusted ({fmtKg(Math.abs(r.adjustedG), 1)}){r.splitG ? ` − cut off (${fmtKg(r.splitG, 1)})` : ""}</div>
          </div>
        </div>
        <div className="card grid grid-cols-2 md:grid-cols-3">
          {[["Batch", b.code, true], ["Fabric PO", r.fabricPO, true], ["Registered", `${fmtDate(r.registeredDate)} · ${locNames.get(r.registeredLocationId)} · weighed by ${r.weighedBy}`], ["Cut from", cutFrom ?? "—", true], ["Challan / notes", [r.challan, r.notes].filter(Boolean).join(" · ") || "—"], ["Label", r.labelActivatedAt ? `activated ${fmtDateTime(r.labelActivatedAt)}` : r.labelPrintedAt ? "printed, not scanned yet" : "not printed"], ["Carbonwork", `${f.cwFabricCode ?? "—"} · ${f.colour ?? ""}`]]
            .map(([k, v, mono]) => <div key={String(k)} className="px-[18px] py-3.5 border-b border-r border-line2"><div className="text-xs text-muted">{k}</div><div className={`text-sm mt-0.5 ${mono ? "mono" : ""}`}>{v}</div></div>)}
        </div>
        <div className="card p-[18px] flex gap-6 items-center flex-wrap">
          <div className="flex-1 min-w-[200px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/barcode?text=${encodeURIComponent(r.serial)}`} alt={r.serial} className="h-[52px] w-full object-contain" />
            <div className="mono text-[13px] font-semibold text-center mt-1.5">{r.serial}</div>
          </div>
          <div className="mono text-xs leading-relaxed text-muted">{f.fabricNo} · {f.itemName}<br />{b.code}<br />{fmtKg(r.weighedG, 1)} kg weighed</div>
        </div>
      </div>
      <div className="card p-5 flex flex-col">
        <div className="font-semibold text-[15px] mb-4">History</div>
        {hist.map((h, i) => (
          <div key={i} className="grid grid-cols-[16px_1fr] gap-3.5">
            <div className="flex flex-col items-center"><div className="w-3 h-3 rounded-full mt-1 flex-none" style={{ background: h.dot }} /><div className="w-[1.5px] flex-1 bg-line" /></div>
            <div className="pb-4">
              <div className="text-sm font-medium">{h.href ? <Link href={h.href} className="underline decoration-line">{h.t}</Link> : h.t}</div>
              <div className="text-xs text-muted mt-0.5">{fmtDateTime(h.at)} · {h.d}</div>
            </div>
          </div>
        ))}
        {["ADMIN", "INVENTORY"].includes(u.role) && (
          <div className="mt-3 flex gap-2 flex-wrap">
            {rack && <Link href={`/warehouse/move?from=${rack.code}`} className="btn flex-1">Move roll</Link>}
            {rack && <Link href={`/warehouse/racks/${rack.code}`} className="btn-ghost flex-1">Open rack</Link>}
            <Link href={`/adjustments/new?serial=${r.serial}`} className="btn-ghost flex-1">Adjust</Link>
          </div>
        )}
      </div>
    </div>
  );
}
