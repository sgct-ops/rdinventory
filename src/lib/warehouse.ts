import "server-only";
import { and, eq, gt, inArray, isNotNull, sql, desc } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { UserError } from "./errors";
import { lock, writeAudit } from "./tx";
import { canPostLocation, type CurrentUser } from "./perm";
import { fmtKg } from "./units";
import { serialOf } from "./codes";

const { rolls, racks, rackMoves, rackCounts, locations, fabricItems, batches, toLines, transferOrders } = schema;
type RollRow = typeof rolls.$inferSelect;
type Who = { email: string };

// ------------------------------------------------------------------ hooks called by the posting engine

export async function isRackedLocation(tx: Tx, locationId: string) {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(racks).where(and(eq(racks.locationId, locationId), eq(racks.active, true)));
  return Number(r?.n ?? 0) > 0;
}

async function locName(tx: Tx, id: string) {
  const [l] = await tx.select({ name: locations.name, type: locations.type }).from(locations).where(eq(locations.id, id));
  return l ?? { name: "?", type: "STORAGE" as const };
}
async function rackCode(tx: Tx, id: string | null) {
  if (!id) return null;
  const [r] = await tx.select({ code: racks.code }).from(racks).where(eq(racks.id, id));
  return r?.code ?? null;
}

async function logMove(tx: Tx, u: Who, r: { id: string; serial: string }, fromLabel: string, toLabel: string, via: string, ref: string | null, note: string) {
  await tx.insert(rackMoves).values({ rollId: r.id, serial: r.serial, fromLabel, toLabel, via, ref, by: u.email, note });
}

/** A posted TO moved a roll between locations: take it off its rack / mark it Unplaced on arrival.
 * This is the TROR link — nobody scans the roll a second time in the warehouse. */
export async function rackOnLocationChange(tx: Tx, u: Who, r: RollRow, fromLoc: string, toLoc: string, ref: string) {
  const from = await locName(tx, fromLoc);
  const to = await locName(tx, toLoc);
  if (r.rackId) {
    const code = await rackCode(tx, r.rackId);
    await tx.update(rolls).set({
      rackId: null, rackSince: null, lastRackId: r.rackId, offRackReason: "MOVED_OUT", offRackRef: ref, offRackAt: new Date(),
    }).where(eq(rolls.id, r.id));
    await logMove(tx, u, r, code ?? "?", to.name, "TO", ref, `Left ${from.name}`);
  } else if (await isRackedLocation(tx, fromLoc)) {
    await tx.update(rolls).set({ offRackReason: "MOVED_OUT", offRackRef: ref, offRackAt: new Date() }).where(eq(rolls.id, r.id));
    await logMove(tx, u, r, "Unplaced", to.name, "TO", ref, "Was not on a rack when it left — check where it was kept");
  }
  if (await isRackedLocation(tx, toLoc)) {
    const returning = !!r.lastRackId || !!r.rackId;
    await tx.update(rolls).set({
      rackId: null, rackSince: null, offRackReason: returning ? "RETURNED" : "ARRIVED", offRackRef: ref, offRackAt: new Date(),
      ...(r.rackId ? { lastRackId: r.rackId } : {}),
    }).where(eq(rolls.id, r.id));
    await logMove(tx, u, r, from.name, "Unplaced", "TO", ref, returning ? `Back from ${from.name} — put it away` : `Arrived from ${from.name} — put it away`);
  }
}

/** Kg changed (consumption, adjustment, reversal). A finished roll comes off its rack. */
export async function rackOnKgChange(tx: Tx, u: Who, r: RollRow, newRemainingG: number, ref: string) {
  if (newRemainingG <= 0 && r.rackId) {
    const code = await rackCode(tx, r.rackId);
    await tx.update(rolls).set({ rackId: null, rackSince: null, lastRackId: r.rackId, offRackReason: "FINISHED", offRackRef: ref, offRackAt: new Date() })
      .where(eq(rolls.id, r.id));
    await logMove(tx, u, r, code ?? "?", "Finished", "TO", ref, "Roll used up (0 kg) — taken off the rack");
  } else if (newRemainingG > 0 && r.remainingG <= 0 && (await isRackedLocation(tx, r.currentLocationId))) {
    await tx.update(rolls).set({ offRackReason: "RETURNED", offRackRef: ref, offRackAt: new Date() }).where(eq(rolls.id, r.id));
    await logMove(tx, u, r, "Finished", "Unplaced", "ADJ", ref, "Kg added back — put it away");
  }
}

// ------------------------------------------------------------------ scans

export type WCard = {
  kind: "ok" | "info" | "warn" | "err" | "return";
  serial: string;
  title?: string;
  hex?: string;
  msg: string;
  sub?: string;
  kgG?: number;
  placed?: boolean;
  action?: "move" | "putBack";
  suggestRack?: string;
  math?: { beforeG: number; minusG: number; refs: string; afterG: number };
};

async function rollFull(tx: Tx, serial: string) {
  const [row] = await tx
    .select({ r: rolls, f: fabricItems, b: batches })
    .from(rolls)
    .innerJoin(fabricItems, eq(fabricItems.id, rolls.fabricItemId))
    .innerJoin(batches, eq(batches.id, rolls.batchId))
    .where(eq(rolls.serial, serial))
    .for("update", { of: rolls });
  return row;
}
async function rackByCode(tx: Tx, code: string) {
  const c = code.trim().toUpperCase().replace(/^RK-/, "");
  const [r] = await tx.select().from(racks).where(eq(racks.code, c));
  if (!r || !r.active) throw new UserError(`Unknown rack label RK-${c}`);
  return r;
}
const title = (f: typeof fabricItems.$inferSelect) => `${f.itemName}${f.colour ? " · " + f.colour : ""}`;

/** Consumption posted while the roll was off its rack (shown as the before − used = after maths). */
async function usedSince(tx: Tx, rollId: string, since: Date | null) {
  if (!since) return { g: 0, refs: "" };
  const list = await tx
    .select({ kg: toLines.kgG, waste: toLines.wasteG, no: transferOrders.toNumber })
    .from(toLines).innerJoin(transferOrders, eq(transferOrders.id, toLines.toId))
    .where(and(eq(toLines.rollId, rollId), eq(transferOrders.type, "CONSUMPTION"), gt(transferOrders.postedAt, since)));
  return { g: list.reduce((a, l) => a + l.kg + l.waste, 0), refs: [...new Set(list.map((l) => l.no))].join(", ") };
}

function ensureWarehouseUser(u: CurrentUser) {
  if (!["ADMIN", "INVENTORY"].includes(u.role)) throw new UserError("Only Inventory or Admin work the racks.");
}

async function placeOnRack(tx: Tx, u: CurrentUser, r: RollRow, rack: typeof racks.$inferSelect, fromLabel: string, note: string, via = "SCAN") {
  await tx.update(rolls).set({
    rackId: rack.id, rackSince: new Date(), lastRackId: null, offRackReason: null, offRackRef: null, offRackAt: null, missingSince: null,
    takenOutAt: null, takenOutBy: null, takenOutPurpose: null, takenOutFor: null,
  }).where(eq(rolls.id, r.id));
  await logMove(tx, u, r, fromLabel, rack.code, via, null, note);
}

/** Put away: scan a rack label (sets the rack) then rolls. A roll back from production can be scanned first. */
export async function putAwayScan(
  u: CurrentUser, input: { rackCode: string | null; serial: string; confirm?: "move" | "putBack" },
): Promise<WCard> {
  ensureWarehouseUser(u);
  const serial = serialOf(input.serial);
  return db.transaction(async (tx) => {
    await lock(tx);
    const row = await rollFull(tx, serial);
    if (!row) return { kind: "err", serial, msg: "Serial not found in Rolls. Register it first." };
    const { r, f } = row;
    const base = { serial, title: title(f), hex: f.hex ?? undefined, kgG: r.remainingG };
    if (r.status === "FINISHED") return { ...base, kind: "err", msg: "This roll is Finished (0 kg)." };
    if (!canPostLocation(u, r.currentLocationId)) return { ...base, kind: "err", msg: "You may not post for this roll's location." };

    if (r.takenOutPurpose === "TROR") return { ...base, kind: "err", msg: `Picked for ${r.takenOutFor}. Remove it from that TROR first (Pick a TROR), then put it back.` };
    const isReturn = !r.rackId && !!r.lastRackId && (r.offRackReason === "RETURNED" || r.offRackReason === "TAKEN_OUT");
    const since = await usedSince(tx, r.id, r.offRackAt);
    const math = since.g > 0 ? { beforeG: r.remainingG + since.g, minusG: since.g, refs: since.refs, afterG: r.remainingG } : undefined;

    let rack: typeof racks.$inferSelect | null = input.rackCode ? await rackByCode(tx, input.rackCode) : null;
    if (input.confirm === "putBack" && r.lastRackId) {
      const [lr] = await tx.select().from(racks).where(eq(racks.id, r.lastRackId));
      rack = lr ?? rack;
    }
    if (!rack) {
      if (isReturn) {
        const code = await rackCode(tx, r.lastRackId);
        return { ...base, kind: "return", suggestRack: code ?? undefined, action: "putBack", math,
          msg: r.takenOutAt ? `Back from ${r.takenOutPurpose === "SAMPLING" ? "sampling" : `production (${r.takenOutFor ?? ""})`}. It left rack ${code}.` : `Back from ${r.offRackRef ?? "a TO"}. It left rack ${code}.`, sub: `Put it back on ${code}, or scan another rack label to place it elsewhere.` };
      }
      throw new UserError("Scan a rack label first (RK-…). A roll coming back can be scanned first.");
    }
    if (r.currentLocationId !== rack.locationId) {
      const l = await locName(tx, r.currentLocationId);
      return { ...base, kind: "err", msg: `In the ledger this roll is at ${l.name}, not here. Post the Transfer TO that brings it here first — it will then show as Unplaced.` };
    }
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(rolls).where(eq(rolls.rackId, rack.id));
    const fullNote = Number(n) >= rack.capacity ? ` Rack is at capacity (${n}/${rack.capacity}).` : "";

    // First placement doubles as the label's first scan (Awaiting label → In stock)
    if (r.status === "AWAITING_LABEL") {
      await tx.update(rolls).set({ status: "IN_STOCK", labelActivatedAt: new Date() }).where(eq(rolls.id, r.id));
      await writeAudit(tx, u, "LABEL_ACTIVATED", "roll", r.id, { rollSerials: serial, kgBeforeG: r.remainingG, kgAfterG: r.remainingG, details: { via: "put away", rack: rack.code } });
      await placeOnRack(tx, u, r, rack, "Unplaced", "First placement · label activated");
      return { ...base, kind: "ok", placed: true, msg: `Placed on ${rack.code}. Label activated — roll is now In stock.${fullNote}` };
    }
    // a cut piece is in stock but its new label hasn't been scanned yet: this scan activates it
    if (!r.labelActivatedAt) {
      await tx.update(rolls).set({ labelActivatedAt: new Date() }).where(eq(rolls.id, r.id));
      await writeAudit(tx, u, "LABEL_ACTIVATED", "roll", r.id, { rollSerials: serial, details: { via: "put away", rack: rack.code } });
    }
    if (r.rackId === rack.id) {
      if (r.missingSince) await tx.update(rolls).set({ missingSince: null }).where(eq(rolls.id, r.id));
      return { ...base, kind: "info", msg: `Already on ${rack.code}.` };
    }
    if (r.rackId) {
      const cur = await rackCode(tx, r.rackId);
      if (input.confirm !== "move")
        return { ...base, kind: "warn", action: "move", msg: `Map says it's on ${cur}. Moving it here only updates its rack.` };
      await placeOnRack(tx, u, r, rack, cur ?? "?", "Moved during put away");
      return { ...base, kind: "ok", placed: true, msg: `Moved from ${cur} to ${rack.code}.${fullNote}` };
    }
    const lastCode = await rackCode(tx, r.lastRackId);
    await placeOnRack(tx, u, r, rack, "Unplaced",
      isReturn ? `Back from ${r.offRackRef ?? "TO"}${math ? ` · ${fmtKg(math.beforeG, 1)} → ${fmtKg(math.afterG, 1)} kg` : ""}` : "First placement");
    const where = isReturn ? (lastCode === rack.code ? `Back on ${rack.code}, the rack it left from.` : `Placed on ${rack.code} (it left from ${lastCode}).`) : `Placed on ${rack.code}.`;
    return { ...base, kind: "ok", placed: true, math, msg: `${where}${math ? " Consumption from the TO Log is already applied." : ""}${fullNote}` };
  });
}

/** Move: rack → rack, no TO. Each roll moves the moment it is scanned. */
export async function moveScan(u: CurrentUser, input: { from: string; to: string; serial: string }): Promise<WCard> {
  ensureWarehouseUser(u);
  const serial = serialOf(input.serial);
  return db.transaction(async (tx) => {
    await lock(tx);
    const from = await rackByCode(tx, input.from);
    const to = await rackByCode(tx, input.to);
    if (from.id === to.id) throw new UserError("The destination must be a different rack.");
    if (from.locationId !== to.locationId) throw new UserError("Racks are in different locations — use a Transfer TO.");
    const row = await rollFull(tx, serial);
    if (!row) return { kind: "err", serial, msg: "Serial not found in Rolls" };
    const { r, f } = row;
    const base = { serial, title: title(f), hex: f.hex ?? undefined, kgG: r.remainingG };
    if (!r.rackId) return { ...base, kind: "err", msg: "Not on a rack. Use Put away for Unplaced rolls." };
    if (r.rackId === to.id) return { ...base, kind: "info", msg: `Already on ${to.code}` };
    const was = await rackCode(tx, r.rackId);
    const odd = r.rackId !== from.id;
    await placeOnRack(tx, u, r, to, was ?? "?", odd ? `Map had it on ${was}, not ${from.code}` : "Rack to rack");
    return { ...base, kind: odd ? "warn" : "ok", placed: true,
      msg: odd ? `Moved to ${to.code}. The map had it on ${was}, not ${from.code}; logged.` : `${fmtKg(r.remainingG, 1)} kg · ${was} → ${to.code}` };
  });
}

// ------------------------------------------------------------------ counts

type CountDetails = { found: string[]; unexpected: string[]; fixed: string[]; missing?: string[]; cancelled?: boolean };

export async function startCount(u: CurrentUser, code: string) {
  ensureWarehouseUser(u);
  return db.transaction(async (tx) => {
    const rack = await rackByCode(tx, code);
    if (!canPostLocation(u, rack.locationId)) throw new UserError("You may not post for this location.");
    const [c] = await tx.insert(rackCounts).values({ rackId: rack.id, by: u.email, details: { found: [], unexpected: [], fixed: [] } }).returning();
    return { countId: c.id, rack: rack.code };
  });
}

export async function countScan(u: CurrentUser, countId: string, serialRaw: string) {
  ensureWarehouseUser(u);
  const serial = serialOf(serialRaw);
  return db.transaction(async (tx) => {
    await lock(tx);
    const [c] = await tx.select().from(rackCounts).where(eq(rackCounts.id, countId)).for("update");
    if (!c || c.finishedAt) throw new UserError("This count is closed. Start a new one.");
    const d = c.details as CountDetails;
    if (serial.startsWith("RK-")) throw new UserError("That's a rack label. Press Other rack to count a different rack.");
    const [r] = await tx.select().from(rolls).where(eq(rolls.serial, serial));
    if (!r) throw new UserError(`${serial} not found in Rolls`);
    if (d.found.includes(serial) || d.unexpected.includes(serial)) return { status: "dupe" as const };
    if (r.rackId === c.rackId) d.found.push(serial);
    else d.unexpected.push(serial);
    await tx.update(rackCounts).set({ details: d }).where(eq(rackCounts.id, c.id));
    return { status: r.rackId === c.rackId ? ("found" as const) : ("unexpected" as const) };
  });
}

/** "It's on this rack now" for a roll the map had somewhere else. */
export async function countFixHere(u: CurrentUser, countId: string, serial: string) {
  ensureWarehouseUser(u);
  return db.transaction(async (tx) => {
    await lock(tx);
    const [c] = await tx.select().from(rackCounts).where(eq(rackCounts.id, countId)).for("update");
    if (!c || c.finishedAt) throw new UserError("This count is closed.");
    const d = c.details as CountDetails;
    const [rack] = await tx.select().from(racks).where(eq(racks.id, c.rackId));
    const [r] = await tx.select().from(rolls).where(eq(rolls.serial, serial)).for("update");
    if (!r) throw new UserError("No such roll");
    if (r.currentLocationId !== rack.locationId) {
      const l = await locName(tx, r.currentLocationId);
      throw new UserError(`In the ledger ${serial} is at ${l.name}. Post the Transfer TO first, or investigate — a count can't move stock between locations.`);
    }
    if (r.status === "FINISHED") throw new UserError(`${serial} is Finished (0 kg) in the ledger. Post an Adjustment (Found) if it's really here.`);
    const was = (await rackCode(tx, r.rackId)) ?? "Unplaced";
    await tx.update(rolls).set({ rackId: rack.id, rackSince: new Date(), lastRackId: null, offRackReason: null, offRackRef: null, offRackAt: null, missingSince: null })
      .where(eq(rolls.id, r.id));
    await logMove(tx, u, r, was, rack.code, "COUNT", `Count ${rack.code}`, `Found on ${rack.code} at count · map said ${was}`);
    d.unexpected = d.unexpected.filter((s) => s !== serial);
    d.found.push(serial); d.fixed.push(serial);
    await tx.update(rackCounts).set({ details: d }).where(eq(rackCounts.id, c.id));
  });
}

export async function finishCount(u: CurrentUser, countId: string, note: string) {
  ensureWarehouseUser(u);
  return db.transaction(async (tx) => {
    await lock(tx);
    const [c] = await tx.select().from(rackCounts).where(eq(rackCounts.id, countId)).for("update");
    if (!c || c.finishedAt) throw new UserError("This count is already closed.");
    const d = c.details as CountDetails;
    const [rack] = await tx.select().from(racks).where(eq(racks.id, c.rackId));
    const expected = await tx.select().from(rolls).where(eq(rolls.rackId, rack.id));
    const missing = expected.filter((r) => !d.found.includes(r.serial));
    for (const r of missing) {
      await tx.update(rolls).set({ missingSince: new Date() }).where(eq(rolls.id, r.id));
      await logMove(tx, u, r, rack.code, "?", "COUNT", `Count ${rack.code}`, "Not found on the rack; flagged Missing");
    }
    d.missing = missing.map((r) => r.serial);
    const autoNote = missing.length ? `${d.missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` +${missing.length - 3}` : ""} missing` : "";
    await tx.update(rackCounts).set({
      finishedAt: new Date(), expected: expected.length, found: expected.length - missing.length, gaps: missing.length,
      note: [note.trim(), autoNote, d.fixed.length ? `${d.fixed.length} fixed` : ""].filter(Boolean).join(" · ") || null, details: d,
    }).where(eq(rackCounts.id, c.id));
    await tx.update(racks).set({ lastCountedAt: new Date(), lastCountGaps: missing.length }).where(eq(racks.id, rack.id));
    await writeAudit(tx, u, "RACK_COUNTED", "rack", rack.id, { details: { rack: rack.code, expected: expected.length, missing: d.missing, unexpected: d.unexpected } });
    return { gaps: missing.length, missing: d.missing, expected: expected.length };
  });
}

export async function cancelCount(u: CurrentUser, countId: string) {
  ensureWarehouseUser(u);
  const [c] = await db.select().from(rackCounts).where(eq(rackCounts.id, countId));
  if (!c || c.finishedAt) return;
  await db.update(rackCounts).set({ finishedAt: new Date(), note: "Cancelled", details: { ...(c.details as CountDetails), cancelled: true } })
    .where(eq(rackCounts.id, countId));
}

// ------------------------------------------------------------------ read models for the pages

export type MapRoll = {
  id: string; serial: string; fabricNo: string | null; item: string; colour: string | null; hex: string;
  batch: string; fabricPO: string; weighedG: number; remainingG: number; consumedG: number;
  rackId: string | null; since: string | null; missing: boolean; status: string;
  offRackReason: string | null; offRackRef: string | null; offRackAt: string | null; lastRack: string | null; location: string;
};

export async function warehouseData() {
  const rackList = await db.select({ r: racks, l: locations }).from(racks).innerJoin(locations, eq(locations.id, racks.locationId))
    .where(eq(racks.active, true)).orderBy(racks.sortOrder, racks.code);
  const locIds = [...new Set(rackList.map((x) => x.r.locationId))];
  const rackCodeById = new Map(rackList.map((x) => [x.r.id, x.r.code]));
  const base = () => db.select({ r: rolls, f: fabricItems, b: batches, l: locations }).from(rolls)
    .innerJoin(fabricItems, eq(fabricItems.id, rolls.fabricItemId))
    .innerJoin(batches, eq(batches.id, rolls.batchId))
    .innerJoin(locations, eq(locations.id, rolls.currentLocationId));
  const here = locIds.length ? await base().where(and(inArray(rolls.currentLocationId, locIds), gt(rolls.remainingG, 0))) : [];
  // Out: left a racked location within the last 45 days and not back yet
  const out = await base().where(and(isNotNull(rolls.lastRackId), eq(rolls.offRackReason, "MOVED_OUT"),
    sql`${rolls.offRackAt} > now() - interval '45 days'`, locIds.length ? sql`${rolls.currentLocationId} not in (${sql.join(locIds.map((i) => sql`${i}`), sql`, `)})` : sql`true`))
    .orderBy(desc(rolls.offRackAt)).limit(100);
  const toMap = (x: (typeof here)[number]): MapRoll => ({
    id: x.r.id, serial: x.r.serial, fabricNo: x.f.fabricNo, item: x.f.itemName, colour: x.f.colour, hex: fabricHex(x.f.hex, x.f.colour, x.f.id),
    batch: x.b.code, fabricPO: x.r.fabricPO, weighedG: x.r.weighedG, remainingG: x.r.remainingG, consumedG: x.r.consumedG,
    rackId: x.r.rackId, since: x.r.rackSince?.toISOString() ?? null, missing: !!x.r.missingSince, status: x.r.status,
    offRackReason: x.r.offRackReason, offRackRef: x.r.offRackRef, offRackAt: x.r.offRackAt?.toISOString() ?? null,
    lastRack: x.r.lastRackId ? rackCodeById.get(x.r.lastRackId) ?? null : null, location: x.l.name,
  });
  return {
    racks: rackList.map((x) => ({ ...x.r, locationName: x.l.name, lastCountedAt: x.r.lastCountedAt?.toISOString() ?? null, createdAt: undefined })),
    rolls: here.map(toMap),
    out: out.map(toMap),
  };
}

const NAMED: Record<string, string> = {
  black: "#1d1d1d", white: "#fbfaf6", "off white": "#e9e3d3", ivory: "#efe8d8", navy: "#24304f", olive: "#6f6d3e", rust: "#a5502f",
  sky: "#9fc4dc", beige: "#cbb898", "coal melange": "#55565a", grey: "#8e8e8e", gray: "#8e8e8e", red: "#b3302b", maroon: "#6b2030",
  green: "#3f7a4a", blue: "#2f5d9a", pink: "#e2a3b5", yellow: "#e6c34a", brown: "#6e4b33", mustard: "#c9a13b", teal: "#2d7a7a",
  "grey melange": "#a3a3a0", ecru: "#e6dcc5", cream: "#f1e8d0", lavender: "#b6a6d6", peach: "#f0b89a",
};
export function fabricHex(hex: string | null, colour: string | null, seed: string) {
  if (hex && /^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const c = (colour || "").toLowerCase().trim();
  if (NAMED[c]) return NAMED[c];
  for (const k of Object.keys(NAMED)) if (c.includes(k)) return NAMED[k];
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 35% 55%)`;
}
