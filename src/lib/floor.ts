import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { UserError } from "./errors";
import { lock, writeAudit } from "./tx";
import { fmtKg, todayIST, toG } from "./units";
import { FMT } from "./formats";
import { serialOf } from "./codes";
import { resolveFabric, postTO, previewTO, takeNumber, type TOInput } from "./posting";
import type { CurrentUser } from "./perm";

/**
 * The warehouse floor:
 *  - Take out for production / sampling: the roll comes off its rack before the TROC is made (FIFO pick list shows the oldest first).
 *  - Roll locator: which building, room and rack a roll is on.
 *  - Planned TROR → pick → dispatch: the office makes the TROR (number + PDF), the warehouse scans the rolls against it,
 *    the app checks every roll belongs to it, and stock moves once, on Dispatch.
 */
const { rolls, racks, rackMoves, fabricItems, batches, locations, transferOrders, toItems, toPicks } = schema;
const TOL = 50;
type Roll = typeof rolls.$inferSelect;

function floorUser(u: CurrentUser) {
  if (!["ADMIN", "INVENTORY"].includes(u.role)) throw new UserError("Only Inventory or Admin work the floor.");
}
async function logMove(tx: Tx, u: { email: string }, r: { id: string; serial: string }, from: string, to: string, via: string, ref: string | null, note: string) {
  await tx.insert(rackMoves).values({ rollId: r.id, serial: r.serial, fromLabel: from, toLabel: to, via, ref, by: u.email, note });
}
async function rackCodeOf(tx: Tx, id: string | null) {
  if (!id) return null;
  const [r] = await tx.select({ code: racks.code }).from(racks).where(eq(racks.id, id));
  return r?.code ?? null;
}

// ------------------------------------------------------------------ FIFO pick list + locator

export type FifoRoll = { serial: string; kgG: number; received: string; rack: string | null; room: string | null; building: string | null; batch: string; invoice: string | null; ageDays: number };

/** Rolls of one fabric at a location, oldest first, that can be taken (in stock, not taken out). */
export async function fifoRolls(fabricQuery: string, locationId?: string, limit = 12) {
  const fabs = await db.select().from(fabricItems).where(eq(fabricItems.active, true));
  const f = resolveFabric(fabs, fabricQuery);
  if (!f) return { fabric: null, rolls: [] as FifoRoll[], totalG: 0 };
  const loc = locationId ?? (await db.select().from(locations).where(eq(locations.name, "Rajdanga Storage")))[0]?.id;
  const rows = (await db.execute(sql`
    select r.serial, r.remaining_g, r.registered_date, r.invoice_no, k.code rack, k.room, k.building, b.code batch,
      (current_date - r.registered_date)::int age
    from rolls r join batches b on b.id = r.batch_id left join racks k on k.id = r.rack_id
    where r.fabric_item_id = ${f.id} and r.current_location_id = ${loc ?? ""} and r.status = 'IN_STOCK' and r.taken_out_at is null and r.remaining_g > 0
    order by r.registered_date, r.created_at, r.serial limit ${limit}`)).rows as Record<string, never>[];
  const [{ g }] = (await db.execute(sql`select coalesce(sum(remaining_g),0)::int g from rolls where fabric_item_id = ${f.id} and current_location_id = ${loc ?? ""}
    and status = 'IN_STOCK' and taken_out_at is null`)).rows as { g: number }[];
  return {
    fabric: { id: f.id, fabricNo: f.fabricNo, sku: f.sku, label: `${f.itemName}${f.colour ? " · " + f.colour : ""}` }, totalG: g,
    rolls: rows.map((r): FifoRoll => ({ serial: r.serial, kgG: r.remaining_g, received: r.registered_date, rack: r.rack, room: r.room, building: r.building, batch: r.batch, invoice: r.invoice_no, ageDays: r.age })),
  };
}

/** Where is this roll? Building, room, rack, the other racks in the room, and what's going on with it. */
export async function locateRoll(code: string) {
  const serial = serialOf(code);
  const [row] = await db.select({ r: rolls, f: fabricItems, b: batches, l: locations }).from(rolls)
    .innerJoin(fabricItems, eq(fabricItems.id, rolls.fabricItemId)).innerJoin(batches, eq(batches.id, rolls.batchId))
    .innerJoin(locations, eq(locations.id, rolls.currentLocationId)).where(eq(rolls.serial, serial));
  if (!row) return null;
  const { r, f, b, l } = row;
  const rackId = r.rackId ?? r.lastRackId;
  const [rack] = rackId ? await db.select().from(racks).where(eq(racks.id, rackId)) : [];
  const room = rack ? (await db.execute(sql`select k.code, k.capacity, count(x.id)::int n from racks k left join rolls x on x.rack_id = k.id and x.status <> 'FINISHED'
      where k.active and k.location_id = ${rack.locationId} and k.room = ${rack.room} and k.building = ${rack.building} group by k.id order by k.sort_order, k.code`)).rows as { code: string; capacity: number; n: number }[] : [];
  return {
    serial: r.serial, fabricNo: f.fabricNo, item: f.itemName, colour: f.colour, sku: f.sku, batch: b.code, invoice: r.invoiceNo, po: r.fabricPO,
    kgG: r.remainingG, status: r.status, location: l.name, onRack: !!r.rackId, rack: rack?.code ?? null, room: rack?.room ?? null, building: rack?.building ?? null,
    roomRacks: room, takenOut: r.takenOutAt ? { purpose: r.takenOutPurpose, for: r.takenOutFor, by: r.takenOutBy, at: r.takenOutAt.toISOString() } : null,
    offRack: !r.rackId ? r.offRackReason : null, received: r.registeredDate,
  };
}

// ------------------------------------------------------------------ take out for production / sampling

export type TakeOutResult =
  | { kind: "ok"; serial: string; msg: string; kgG: number; title: string; rack: string | null }
  | { kind: "confirm"; serial: string; msg: string; oldest: { serial: string; rack: string | null; received: string } }
  | { kind: "err"; serial: string; msg: string };

export async function takeOut(u: CurrentUser, p: { code: string; purpose: string; forPO?: string; fabric?: string; confirmNotOldest?: boolean }): Promise<TakeOutResult> {
  floorUser(u);
  const serial = serialOf(p.code);
  const purpose = p.purpose === "SAMPLING" ? "SAMPLING" : "PRODUCTION";
  const forPO = String(p.forPO || "").trim().toUpperCase();
  if (purpose === "PRODUCTION" && !FMT.stylePO.test(forPO)) throw new UserError("Type the style PO this roll is going out for (CT26/PO/88 or PO-112).");
  return db.transaction(async (tx) => {
    await lock(tx);
    const [r] = await tx.select().from(rolls).where(eq(rolls.serial, serial)).for("update");
    if (!r) return { kind: "err" as const, serial, msg: "No roll with this serial." };
    const [f] = await tx.select().from(fabricItems).where(eq(fabricItems.id, r.fabricItemId));
    const title = `${f.fabricNo} · ${f.itemName}${f.colour ? " · " + f.colour : ""}`;
    if (p.fabric) {
      const want = resolveFabric([f], p.fabric);
      if (!want) return { kind: "err" as const, serial, msg: `${serial} is ${f.fabricNo} (${f.sku ?? f.itemName}), not ${p.fabric.toUpperCase()}.` };
    }
    if (r.status === "FINISHED") return { kind: "err" as const, serial, msg: "This roll is finished (0 kg)." };
    if (r.status === "AWAITING_LABEL") return { kind: "err" as const, serial, msg: "Label not scanned in yet. Put it away first." };
    if (r.takenOutAt) return { kind: "err" as const, serial, msg: `Already taken out for ${r.takenOutPurpose === "TROR" ? r.takenOutFor : `${(r.takenOutPurpose ?? "").toLowerCase()} · ${r.takenOutFor ?? ""}`} by ${r.takenOutBy?.split("@")[0]}.` };
    const [hasRacks] = (await tx.execute(sql`select count(*)::int n from racks where active and location_id = ${r.currentLocationId}`)).rows as { n: number }[];
    if (!hasRacks.n) { const [l] = await tx.select().from(locations).where(eq(locations.id, r.currentLocationId)); return { kind: "err" as const, serial, msg: `This roll is at ${l?.name}, not in the warehouse.` }; }
    // FIFO: is there an older roll of the same fabric still on the racks?
    const [old] = (await tx.execute(sql`select r.serial, r.registered_date, k.code rack from rolls r left join racks k on k.id = r.rack_id
      where r.fabric_item_id = ${r.fabricItemId} and r.current_location_id = ${r.currentLocationId} and r.status = 'IN_STOCK' and r.taken_out_at is null and r.remaining_g > 0
      order by r.registered_date, r.created_at, r.serial limit 1`)).rows as { serial: string; registered_date: string; rack: string | null }[];
    if (old && old.serial !== r.serial && old.registered_date < r.registeredDate && !p.confirmNotOldest)
      return { kind: "confirm" as const, serial, oldest: { serial: old.serial, rack: old.rack, received: old.registered_date },
        msg: `Not the oldest ${f.fabricNo}: ${old.serial}${old.rack ? ` on ${old.rack}` : ""} came in on ${old.registered_date}. Take ${serial} anyway?` };
    const rack = await rackCodeOf(tx, r.rackId);
    await tx.update(rolls).set({ takenOutAt: new Date(), takenOutBy: u.email, takenOutPurpose: purpose, takenOutFor: forPO || null,
      rackId: null, rackSince: null, lastRackId: r.rackId ?? r.lastRackId, offRackReason: "TAKEN_OUT", offRackRef: forPO || purpose, offRackAt: new Date() }).where(eq(rolls.id, r.id));
    await logMove(tx, u, r, rack ?? "Unplaced", `Out · ${purpose === "SAMPLING" ? "Sampling" : "Production"}`, "TAKEOUT", forPO || null, `Taken out for ${purpose.toLowerCase()}${forPO ? ` · ${forPO}` : ""}`);
    await writeAudit(tx, u, "TAKEN_OUT", "roll", r.id, { rollSerials: serial, kgBeforeG: r.remainingG, details: { purpose, for: forPO, rack } });
    return { kind: "ok" as const, serial, title, rack, kgG: r.remainingG, msg: `${serial} taken out${rack ? ` from ${rack}` : ""} for ${purpose === "SAMPLING" ? "sampling" : forPO}. Make the TROC once it's cut; put it back with Put away.` };
  });
}

export async function takenOutList() {
  return (await db.execute(sql`
    select r.serial, r.remaining_g, r.taken_out_at, r.taken_out_by, r.taken_out_purpose, r.taken_out_for, r.invoice_no, f.fabric_no, f.item_name, f.colour, b.code batch, k.code last_rack,
      (select string_agg(distinct t.to_number, ', ') from to_lines x join transfer_orders t on t.id = x.to_id where x.roll_id = r.id and t.type = 'CONSUMPTION' and t.posted_at > r.taken_out_at) trocs
    from rolls r join fabric_items f on f.id = r.fabric_item_id join batches b on b.id = r.batch_id left join racks k on k.id = r.last_rack_id
    where r.taken_out_at is not null and r.taken_out_purpose in ('PRODUCTION','SAMPLING') order by r.taken_out_at desc`)).rows as Record<string, never>[];
}

// ------------------------------------------------------------------ planned TROR → pick → dispatch

/** Office: make the TROR (number now, PDF for the warehouse). Nothing moves until the warehouse dispatches it. */
export async function planTROR(u: CurrentUser, p: TOInput) {
  if (!["ADMIN", "INVENTORY", "MERCHANDISER"].includes(u.role)) throw new UserError("Your role can't create transfer orders.");
  const input: TOInput = { ...p, type: "TRANSFER", planning: true, lines: p.lines.map((l) => ({ item: l.item, kg: l.kg })) };
  const pre = await previewTO(u, input);
  if (pre.errors.length) return { ok: false as const, errors: pre.errors };
  return db.transaction(async (tx) => {
    await lock(tx);
    const to = await takeNumber(tx, "TRANSFER");
    const src = p.sourceId, dst = p.destinationId;
    const [dl] = await tx.select().from(locations).where(eq(locations.id, dst));
    const [head] = await tx.insert(transferOrders).values({
      toNumber: to, type: "TRANSFER", date: p.date || todayIST(), reason: p.reason?.trim().slice(0, 500) || null, sourceLocationId: src, destLocationId: dst,
      destAddress: dl?.address ?? null, moNumber: p.mo?.trim() || null, taxInvoiceNo: p.invoice?.trim() || null,
      postedBy: u.email, status: "PLANNED", plannedBy: u.email, plannedAt: new Date(),
    }).returning();
    for (const rp of pre.rows) await tx.insert(toItems).values({ toId: head.id, rowNo: rp.row, fabricItemId: rp.fabric!.id, kgG: rp.needG, pick: "PLAN" });
    await writeAudit(tx, u, "PLAN_TRANSFER", "to", head.id, { details: { to, items: pre.rows.map((r) => [r.fabric?.fabricNo, r.needG]) } });
    return { ok: true as const, id: head.id, to };
  });
}

export async function trorView(idOrNumber: string) {
  const key = idOrNumber.trim().toUpperCase();
  const [t] = await db.select().from(transferOrders).where(sql`${transferOrders.id} = ${idOrNumber} or ${transferOrders.toNumber} = ${key}`);
  if (!t || t.type !== "TRANSFER") return null;
  const locs = new Map((await db.select().from(locations)).map((l) => [l.id, l.name]));
  const items = await db.select({ i: toItems, f: fabricItems }).from(toItems).innerJoin(fabricItems, eq(fabricItems.id, toItems.fabricItemId)).where(eq(toItems.toId, t.id)).orderBy(asc(toItems.rowNo));
  const picks = await db.select({ p: toPicks, r: rolls, b: batches }).from(toPicks).innerJoin(rolls, eq(rolls.id, toPicks.rollId)).innerJoin(batches, eq(batches.id, rolls.batchId))
    .where(eq(toPicks.toId, t.id)).orderBy(asc(toPicks.at));
  const rows = [];
  for (const { i, f } of items) {
    const mine = picks.filter((x) => x.p.itemRow === i.rowNo);
    const pickedG = mine.reduce((a, x) => a + x.p.kgG, 0);
    const sug = t.status === "PLANNED" ? (await fifoRolls(f.fabricNo ?? f.sku ?? "", t.sourceLocationId, 8)).rolls : [];
    rows.push({
      row: i.rowNo, fabricId: f.id, fabricNo: f.fabricNo, sku: f.sku, label: `${f.itemName}${f.colour ? " · " + f.colour : ""}`, needG: i.kgG, pickedG, leftG: Math.max(0, i.kgG - pickedG),
      picks: mine.map((x) => ({ serial: x.r.serial, kgG: x.p.kgG, rollG: x.r.remainingG, cut: x.p.cut, batch: x.b.code, invoice: x.r.invoiceNo, by: x.p.by })),
      suggestions: sug,
    });
  }
  return { id: t.id, to: t.toNumber, status: t.status, date: t.date, from: locs.get(t.sourceLocationId) ?? "", to_: locs.get(t.destLocationId) ?? "", sourceId: t.sourceLocationId, destId: t.destLocationId,
    reason: t.reason, mo: t.moNumber, invoice: t.taxInvoiceNo, plannedBy: t.plannedBy, plannedAt: t.plannedAt?.toISOString() ?? null, rows };
}

export async function openTRORs() {
  return (await db.execute(sql`
    select t.id, t.to_number, t.date, t.planned_by, t.planned_at, s.name src, d.name dst,
      coalesce((select sum(kg_g) from to_items i where i.to_id = t.id),0)::int need_g,
      coalesce((select sum(kg_g) from to_picks p where p.to_id = t.id),0)::int picked_g,
      (select count(*) from to_picks p where p.to_id = t.id)::int rolls
    from transfer_orders t join locations s on s.id = t.source_location_id join locations d on d.id = t.dest_location_id
    where t.status = 'PLANNED' order by t.planned_at`)).rows as Record<string, never>[];
}

export type PickResult =
  | { kind: "ok"; msg: string; serial: string; row: number }
  | { kind: "cut"; msg: string; serial: string; row: number; rollG: number; needG: number }
  | { kind: "err"; msg: string; serial: string };

/** Warehouse: scan a roll against the TROR. Any batch of the right fabric is fine; the app checks everything else. */
export async function pickForTROR(u: CurrentUser, toId: string, code: string, opt: { cutKg?: string | number; whole?: boolean } = {}): Promise<PickResult> {
  floorUser(u);
  const serial = serialOf(code);
  return db.transaction(async (tx) => {
    await lock(tx);
    const [t] = await tx.select().from(transferOrders).where(eq(transferOrders.id, toId)).for("update");
    if (!t || t.status !== "PLANNED") return { kind: "err" as const, serial, msg: "This TROR isn't waiting to be picked any more." };
    const [r] = await tx.select().from(rolls).where(eq(rolls.serial, serial)).for("update");
    if (!r) return { kind: "err" as const, serial, msg: "No roll with this serial." };
    const [f] = await tx.select().from(fabricItems).where(eq(fabricItems.id, r.fabricItemId));
    const [dup] = await tx.select().from(toPicks).where(and(eq(toPicks.toId, t.id), eq(toPicks.rollId, r.id)));
    if (dup) return { kind: "err" as const, serial, msg: "Already scanned on this TROR." };
    if (r.currentLocationId !== t.sourceLocationId) return { kind: "err" as const, serial, msg: `${serial} isn't at the TROR's source location.` };
    if (r.status !== "IN_STOCK") return { kind: "err" as const, serial, msg: r.status === "FINISHED" ? "This roll is finished." : "Label not scanned in yet — put it away first." };
    if (r.takenOutAt) return { kind: "err" as const, serial, msg: `Taken out for ${r.takenOutPurpose === "TROR" ? r.takenOutFor : `production (${r.takenOutFor ?? ""})`} — not free to send.` };
    const items = await tx.select().from(toItems).where(eq(toItems.toId, t.id)).orderBy(asc(toItems.rowNo));
    const picks = await tx.select().from(toPicks).where(eq(toPicks.toId, t.id));
    const rowsForFabric = items.filter((i) => i.fabricItemId === r.fabricItemId);
    if (!rowsForFabric.length) {
      const fabs = await tx.select().from(fabricItems).where(inArray(fabricItems.id, items.map((i) => i.fabricItemId)));
      return { kind: "err" as const, serial, msg: `${serial} is ${f.fabricNo}${f.sku ? ` (${f.sku})` : ""}. ${t.toNumber} asks for ${fabs.map((x) => x.fabricNo).join(", ")} only.` };
    }
    const left = (i: typeof items[number]) => i.kgG - picks.filter((p) => p.itemRow === i.rowNo).reduce((a, p) => a + p.kgG, 0);
    const row = rowsForFabric.find((i) => left(i) > TOL);
    if (!row) return { kind: "err" as const, serial, msg: `${f.fabricNo} on ${t.toNumber} is already fully picked.` };
    const need = left(row);
    let kgG = r.remainingG, cut = false;
    if (r.remainingG > need + TOL && !opt.whole) {
      if (opt.cutKg === undefined || opt.cutKg === "") return { kind: "cut" as const, serial, row: row.rowNo, rollG: r.remainingG, needG: need,
        msg: `${serial} has ${fmtKg(r.remainingG)} kg; ${t.toNumber} still needs ${fmtKg(need)} kg of ${f.fabricNo}. Cut it, or send the whole roll?` };
      const g = toG(opt.cutKg);
      if (!(g > 0) || g >= r.remainingG) return { kind: "err" as const, serial, msg: `Cut kg must be above 0 and below ${fmtKg(r.remainingG)} kg.` };
      kgG = g; cut = true;
    }
    if (picks.some((p) => p.itemRow === row.rowNo && p.cut)) return { kind: "err" as const, serial, msg: "This row already has a cut roll. Remove it first to add more." };
    await tx.insert(toPicks).values({ toId: t.id, rollId: r.id, itemRow: row.rowNo, kgG, cut, by: u.email });
    const rack = await rackCodeOf(tx, r.rackId);
    await tx.update(rolls).set({ takenOutAt: new Date(), takenOutBy: u.email, takenOutPurpose: "TROR", takenOutFor: t.toNumber,
      rackId: null, rackSince: null, lastRackId: r.rackId ?? r.lastRackId, offRackReason: "TAKEN_OUT", offRackRef: t.toNumber, offRackAt: new Date() }).where(eq(rolls.id, r.id));
    await logMove(tx, u, r, rack ?? "Unplaced", `Picked · ${t.toNumber}`, "PICK", t.toNumber, cut ? `Picked to cut ${fmtKg(kgG)} kg` : "Picked whole");
    return { kind: "ok" as const, serial, row: row.rowNo, msg: `${serial} · ${f.fabricNo} · ${cut ? `cut ${fmtKg(kgG)} of ${fmtKg(r.remainingG)} kg` : `${fmtKg(kgG)} kg`}${rack ? ` (from ${rack})` : ""}` };
  });
}

async function releaseRoll(tx: Tx, u: { email: string }, r: Roll, ref: string) {
  await tx.update(rolls).set({ takenOutAt: null, takenOutBy: null, takenOutPurpose: null, takenOutFor: null, offRackReason: "RETURNED", offRackRef: ref, offRackAt: new Date() }).where(eq(rolls.id, r.id));
  await logMove(tx, u, r, `Picked · ${ref}`, "Unplaced", "PICK", ref, "Removed from the TROR — put it back on its rack");
}

export async function unpickForTROR(u: CurrentUser, toId: string, code: string) {
  floorUser(u);
  const serial = serialOf(code);
  return db.transaction(async (tx) => {
    await lock(tx);
    const [t] = await tx.select().from(transferOrders).where(eq(transferOrders.id, toId));
    const [r] = await tx.select().from(rolls).where(eq(rolls.serial, serial)).for("update");
    if (!t || !r || t.status !== "PLANNED") throw new UserError("Nothing to remove.");
    await tx.delete(toPicks).where(and(eq(toPicks.toId, t.id), eq(toPicks.rollId, r.id)));
    await releaseRoll(tx, u, r, t.toNumber);
  });
}

/** Stock moves now, once: the picked rolls (cut ones are cut) go to the destination under the TROR's own number. */
export async function dispatchTROR(u: CurrentUser, toId: string, opt: { shortReason?: string } = {}) {
  floorUser(u);
  const v = await trorView(toId);
  if (!v || v.status !== "PLANNED") throw new UserError("This TROR isn't waiting to be dispatched.");
  const short = v.rows.filter((r) => r.leftG > TOL);
  if (!v.rows.some((r) => r.picks.length)) throw new UserError("Scan the rolls first. Nothing is picked yet.");
  if (short.length && !opt.shortReason?.trim())
    return { ok: false as const, short: short.map((r) => ({ fabricNo: r.fabricNo, leftG: r.leftG })), errors: short.map((r) => `${r.fabricNo}: ${fmtKg(r.leftG)} kg still to pick.`) };
  const input: TOInput = {
    type: "TRANSFER", date: todayIST(), sourceId: v.sourceId, destinationId: v.destId, mo: v.mo ?? undefined, invoice: v.invoice ?? undefined,
    reason: [v.reason, short.length ? `Dispatched short: ${opt.shortReason!.trim()}` : ""].filter(Boolean).join(" · ") || undefined,
    lines: v.rows.filter((r) => r.picks.length).map((r) => ({
      item: r.fabricNo ?? "", kg: (r.picks.reduce((a, p) => a + p.kgG, 0) / 1000).toFixed(3),
      serials: [...r.picks.filter((p) => !p.cut), ...r.picks.filter((p) => p.cut)].map((p) => p.serial),
    })),
  };
  const res = await postTO(u, input, { id: v.id, toNumber: v.to });
  return res.ok ? { ok: true as const, to: res.to, cuts: res.cuts, kgG: res.kgG } : { ok: false as const, errors: res.errors };
}

export async function cancelTROR(u: CurrentUser, toId: string, reason: string) {
  if (!["ADMIN", "INVENTORY", "MERCHANDISER"].includes(u.role)) throw new UserError("Your role can't cancel transfer orders.");
  if (!reason.trim()) throw new UserError("Give a reason.");
  return db.transaction(async (tx) => {
    await lock(tx);
    const [t] = await tx.select().from(transferOrders).where(eq(transferOrders.id, toId)).for("update");
    if (!t || t.status !== "PLANNED") throw new UserError("Only a TROR that hasn't been dispatched can be cancelled.");
    const picks = await tx.select({ r: rolls }).from(toPicks).innerJoin(rolls, eq(rolls.id, toPicks.rollId)).where(eq(toPicks.toId, t.id));
    for (const { r } of picks) await releaseRoll(tx, u, r, t.toNumber);
    await tx.delete(toPicks).where(eq(toPicks.toId, t.id));
    await tx.update(transferOrders).set({ status: "CANCELLED", reversalReason: reason.trim() }).where(eq(transferOrders.id, t.id));
    await writeAudit(tx, u, "CANCEL_TRANSFER", "to", t.id, { details: { to: t.toNumber, reason, rolls: picks.length } });
  });
}
