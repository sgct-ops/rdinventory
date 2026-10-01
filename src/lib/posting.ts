import "server-only";
import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { randomInt } from "crypto";
import { db, schema, type Tx } from "@/db";
import { UserError } from "./errors";
import { todayIST, toG, fmtKg } from "./units";
import { canPostLocation, canUseStylePO, type CurrentUser } from "./perm";
import { getSettings } from "./settings";
import { lock, writeAudit, nextCounter } from "./tx";
import { rackOnLocationChange, rackOnKgChange, isRackedLocation } from "./warehouse";
import { FMT, TO_PREFIX, pad3, MAX_ROLL_KG, REASONS, type AdjReason } from "./formats";
import { serialOf, parseCode } from "./codes";

const { rolls, fabricItems, locations, batches, transferOrders, toItems, toLines, orderLinks, adjustments, racks, serialRegistry } = schema;
type Roll = typeof rolls.$inferSelect;
type Fabric = typeof fabricItems.$inferSelect;
type Loc = typeof locations.$inferSelect;
export type TOType = "TRANSFER" | "CONSUMPTION";
const TOL = 50; // 0.05 kg tolerance, as in the sheet

export { REASONS as ADJ_REASONS };
export type { AdjReason };

// ---------------------------------------------------------------- helpers

/** kg left = weighed − consumed + adjusted − cut off into pieces */
export const remOf = (r: Pick<Roll, "weighedG" | "consumedG" | "adjustedG" | "splitG">) => r.weighedG - r.consumedG + r.adjustedG - r.splitG;
function statusFor(r: Pick<Roll, "status" | "labelActivatedAt" | "splitFromId">, remainingG: number): Roll["status"] {
  if (r.status === "AWAITING_LABEL" && !r.labelActivatedAt && !r.splitFromId) return "AWAITING_LABEL";
  return remainingG <= TOL ? "FINISHED" : "IN_STOCK";
}
async function allLocations(tx: Tx) { return tx.select().from(locations); }
const isProd = (l?: Loc) => l?.type === "PRODUCTION";

/** Fabric by Rajdanga Fabric #, SKU or Zoho item name (any case). "55A · SJ …" picks work too. */
export function resolveFabric(list: Fabric[], q: string) {
  const k = String(q || "").trim().toUpperCase().split(" · ")[0].trim();
  if (!k) return null;
  const by = (f: (x: Fabric) => string | null) => list.find((x) => (f(x) ?? "").trim().toUpperCase() === k);
  return by((x) => x.fabricNo) ?? by((x) => x.sku) ?? by((x) => x.itemName) ?? null;
}

async function stockAt(tx: Tx, fabricItemId: string, locationId: string) {
  const [r] = await tx.select({ g: sql<number>`coalesce(sum(${rolls.remainingG}),0)::int` }).from(rolls)
    .where(and(eq(rolls.fabricItemId, fabricItemId), eq(rolls.currentLocationId, locationId), eq(rolls.status, "IN_STOCK")));
  return Number(r?.g ?? 0);
}

/** Shared TROR/TROC series. */
export async function peekNextTO(type: TOType) {
  const [c] = await db.select().from(schema.counters).where(eq(schema.counters.name, "to"));
  return TO_PREFIX[type] + pad3((c?.value ?? 0) + 1);
}
export async function takeNumber(tx: Tx, type: TOType) { return TO_PREFIX[type] + pad3(await nextCounter(tx, "to")); }

/** Serial = <Fabric #>-<4 random digits>. Never issued twice: the registry keeps every serial ever given. */
async function serialMaker(tx: Tx, fabricNo: string) {
  const base = fabricNo.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const taken = new Set((await tx.select({ s: serialRegistry.serial }).from(serialRegistry).where(like(serialRegistry.serial, `${base}-%`))).map((x) => x.s));
  for (const r of await tx.select({ s: rolls.serial }).from(rolls).where(like(rolls.serial, `${base}-%`))) taken.add(r.s);
  return async (how: string) => {
    let s = "";
    for (let i = 0; i < 2000 && !s; i++) { const c = `${base}-${String(randomInt(0, 10000)).padStart(4, "0")}`; if (!taken.has(c)) s = c; }
    if (!s) for (let i = 0; i < 10000 && !s; i++) { const c = `${base}-${String(i).padStart(4, "0")}`; if (!taken.has(c)) s = c; }
    if (!s) throw new UserError(`All 10,000 serials for fabric ${base} are used. Give the new rolls a new Rajdanga Fabric # (e.g. ${base}B).`);
    taken.add(s);
    await tx.insert(serialRegistry).values({ serial: s, fabricNo: base, how });
    return s;
  };
}

// ---------------------------------------------------------------- receive a fabric PO

export type ReceiveInput = {
  fabricPO: string; invoiceNo: string; date: string; locationId: string; challan?: string; note?: string;
  /** the person confirmed receiving more than the PO line expects */
  allowOver?: boolean;
  lines: { item: string; batch?: string; weights: string[] }[];
};
export type ReceiveResult =
  | { ok: false; errors: string[]; over?: { fabricNo: string; expectedG: number; afterG: number }[] }
  | { ok: true; po: string; receipt: string; invoiceNo: string; location: string; rolls: number; kgG: number; batches: { fabricNo: string; fabric: string; colour: string; batch: string; serials: string[]; kgG: number }[] };

/**
 * One receiving against a fabric PO (a PO can be received in several parts). Every fabric is checked against the PO's
 * lines first; nothing is written unless every line is right. Weighed by = the person signed in. Invoice # is required
 * and goes on every roll (and into its barcode).
 */
export async function receivePO(u: CurrentUser, p: ReceiveInput): Promise<ReceiveResult> {
  if (!["ADMIN", "INVENTORY"].includes(u.role)) throw new UserError("Only Inventory or Admin receive fabric.");
  const settings = await getSettings();
  return db.transaction(async (tx) => {
    await lock(tx);
    const errs: string[] = [];
    const po = String(p.fabricPO || "").trim().toUpperCase();
    if (!FMT.fabricPO.test(po)) errs.push("Fabric PO looks wrong. Use CT26/PO/48, CTF/PO/136 or PO-112.");
    const invoiceNo = String(p.invoiceNo || "").trim().toUpperCase();
    if (!invoiceNo) errs.push("Invoice # is required: type or scan the vendor's invoice number.");
    else if (invoiceNo.length > 40 || /[|]/.test(invoiceNo)) errs.push("Invoice # is too long or has a | in it.");
    const date = String(p.date || todayIST());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayIST()) errs.push("Date received must be today or earlier.");
    const locs = await allLocations(tx);
    const loc = locs.find((l) => l.id === p.locationId && l.active);
    if (!loc) errs.push("Pick the location the fabric arrived at.");
    else if (u.receiveLocationId && loc.id !== u.receiveLocationId) errs.push(`Your login receives fabric only at ${locs.find((l) => l.id === u.receiveLocationId)?.name ?? "its own location"}.`);
    else if (!canPostLocation(u, loc.id)) errs.push(`You may not receive fabric at ${loc.name}.`);
    else if (isProd(loc)) errs.push(`${loc.name} is a production location. Receive fabric where it is stored.`);
    // the PO must be registered (from Zoho / Carbonwork / typed in) so we know what it brings
    const [head] = po ? await tx.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.poNumber, po)) : [];
    const poLines = head ? await tx.select().from(schema.poLines).where(eq(schema.poLines.poId, head.id)) : [];
    if (po && FMT.fabricPO.test(po)) {
      if (!head) errs.push(`PO ${po} isn't in Incoming POs, so the app doesn't know what it brings. Add it (or import it from Zoho / Carbonwork) first.`);
      else if (head.status === "CLOSED") errs.push(`PO ${po} is closed. Reopen it under Incoming POs if more fabric came.`);
    }
    const lines = (p.lines || []).filter((l) => String(l.item || "").trim() || (l.weights || []).some((w) => String(w).trim() !== ""));
    if (!lines.length) errs.push("Add at least one fabric with its roll weights.");
    const fabrics = await tx.select().from(fabricItems).where(eq(fabricItems.active, true));
    const onPO = (id: string) => poLines.find((l) => l.fabricItemId === id);
    const poList = () => poLines.map((l) => fabrics.find((f) => f.id === l.fabricItemId)?.fabricNo).filter(Boolean).join(", ");
    const plan: { f: Fabric; kgs: number[]; batch: string }[] = [];
    const seen = new Set<string>();
    for (const [i, l] of lines.entries()) {
      const n = `Fabric ${i + 1}: `;
      const f = resolveFabric(fabrics, l.item);
      if (!f) { errs.push(`${n}no fabric "${String(l.item || "").trim()}" in Fabric Inventory. Use the Rajdanga Fabric # or the SKU.`); continue; }
      const fno = String(f.fabricNo ?? "");
      if (!FMT.fabricNo.test(fno)) { errs.push(`${n}Rajdanga Fabric # "${fno}" should be a number, optionally with letters after it (55, 55A, 55B). Fix it in Fabric Inventory.`); continue; }
      if (head && !onPO(f.id)) { errs.push(`${n}PO ${po} has no ${fno}${f.sku ? ` (${f.sku})` : ""} to receive. This PO brings: ${poList() || "nothing yet"}.`); continue; }
      if (seen.has(f.id)) { errs.push(`${n}${fno} is on two cards. Put all its rolls on one card.`); continue; }
      seen.add(f.id);
      const raw = (l.weights || []).map((w) => String(w).trim()).filter((w) => w !== "");
      const bad = raw.filter((w) => !(toG(w) > 0));
      if (bad.length) { errs.push(`${n}these weights are not numbers above 0: ${bad.join(", ")}.`); continue; }
      const kgs = raw.map((w) => toG(w));
      if (!kgs.length) { errs.push(`${n}type at least one roll weight.`); continue; }
      const heavy = kgs.filter((g) => g > MAX_ROLL_KG * 1000);
      if (heavy.length) { errs.push(`${n}a roll weight is above ${MAX_ROLL_KG} kg (${heavy.map((g) => fmtKg(g)).join(", ")}). Check it.`); continue; }
      const batch = String(l.batch || "").trim().toUpperCase();
      if (batch) {
        const [b] = await tx.select().from(batches).where(eq(batches.code, batch));
        if (b && b.fabricItemId !== f.id) {
          const [bf] = await tx.select().from(fabricItems).where(eq(fabricItems.id, b.fabricItemId));
          errs.push(`${n}batch ${batch} belongs to fabric ${bf?.fabricNo}, not ${fno}.`); continue;
        }
      }
      plan.push({ f, kgs, batch });
    }
    if (errs.length) return { ok: false as const, errors: errs };
    // more than the PO line expects? ask first
    const over: { fabricNo: string; expectedG: number; afterG: number }[] = [];
    if (head) for (const x of plan) {
      const line = onPO(x.f.id)!;
      const [{ g }] = (await tx.execute(sql`select coalesce(sum(weighed_g),0)::int g from rolls where fabric_po = ${po} and fabric_item_id = ${x.f.id} and split_from_id is null`)).rows as { g: number }[];
      const after = g + x.kgs.reduce((a, b) => a + b, 0);
      if (after > line.expectedG * (1 + Number(settings.poOverPct || 10) / 100)) over.push({ fabricNo: x.f.fabricNo!, expectedG: line.expectedG, afterG: after });
    }
    if (over.length && !p.allowOver) return { ok: false as const, over,
      errors: over.map((o) => `${o.fabricNo}: this brings it to ${fmtKg(o.afterG, 1)} kg against ${fmtKg(o.expectedG, 1)} kg on the PO.`) };

    const receiptNo = `GRN-${date.replaceAll("-", "").slice(2)}-${String(await nextCounter(tx, "receipt")).padStart(4, "0")}`;
    const [rc] = await tx.insert(schema.receipts).values({ number: receiptNo, poId: head?.id ?? null, poNumber: po, invoiceNo, challan: p.challan?.trim() || null,
      date, locationId: loc!.id, rolls: 0, kgG: 0, receivedBy: u.email }).returning();
    const nextSeq = new Map<string, number>();
    const results: Extract<ReceiveResult, { ok: true }>["batches"] = [];
    let total = 0, count = 0;
    const racked = await isRackedLocation(tx, loc!.id);
    const weighedBy = u.name?.trim() || u.email;
    for (const x of plan) {
      const fabricNo = x.f.fabricNo!.toUpperCase().replace(/[^A-Z0-9-]/g, "");
      let batchRow: typeof batches.$inferSelect | undefined;
      if (x.batch) {
        [batchRow] = await tx.select().from(batches).where(eq(batches.code, x.batch));
        if (!batchRow) [batchRow] = await tx.insert(batches).values({ code: x.batch, fabricItemId: x.f.id, fabricPO: po, seq: 0 }).returning();
      } else {
        const base = `B-${po.replace(/[^A-Z0-9]/g, "")}-${fabricNo}-`;
        if (!nextSeq.has(base)) {
          const ex = await tx.select({ c: batches.code }).from(batches).where(like(batches.code, `${base}%`));
          nextSeq.set(base, Math.max(0, ...ex.map((e) => Number(e.c.slice(base.length)) || 0)));
        }
        const seq = nextSeq.get(base)! + 1; nextSeq.set(base, seq);
        [batchRow] = await tx.insert(batches).values({ code: base + String(seq).padStart(2, "0"), fabricItemId: x.f.id, fabricPO: po, seq }).returning();
      }
      const newSerial = await serialMaker(tx, fabricNo);
      const serials: string[] = [];
      for (const g of x.kgs) {
        const serial = await newSerial(`Received on ${po} (${receiptNo})`);
        await tx.insert(rolls).values({
          serial, batchId: batchRow.id, fabricItemId: x.f.id, fabricPO: po, registeredDate: date, registeredLocationId: loc!.id,
          weighedG: g, weighedBy, registeredBy: u.email, challan: p.challan?.trim() || null, invoiceNo, receiptId: rc.id,
          notes: p.note?.trim() || null, currentLocationId: loc!.id, remainingG: g, status: "AWAITING_LABEL", lastMovement: `Received on ${po} · ${receiptNo}`,
          offRackReason: racked ? "NEW" : null,
        });
        serials.push(serial);
        total += g; count++;
      }
      results.push({ fabricNo: x.f.fabricNo!, fabric: x.f.cwFabricCode ?? x.f.itemName, colour: x.f.colour ?? "", batch: batchRow.code, serials, kgG: x.kgs.reduce((a, b) => a + b, 0) });
    }
    await tx.update(schema.receipts).set({ rolls: count, kgG: total }).where(eq(schema.receipts.id, rc.id));
    await writeAudit(tx, u, "RECEIVE_PO", "po", head?.id ?? null, {
      rollSerials: results.flatMap((r) => r.serials).join(","), kgAfterG: total,
      details: { po, receipt: receiptNo, invoice: invoiceNo, location: loc!.name, date, challan: p.challan ?? "", over: over.length ? over : undefined, batches: results.map((r) => [r.fabricNo, r.batch, r.serials.length, r.kgG]) },
    });
    await tx.delete(schema.drafts).where(and(eq(schema.drafts.userId, u.id), eq(schema.drafts.kind, "RECEIVE")));
    return { ok: true as const, po, receipt: receiptNo, invoiceNo, location: loc!.name, rolls: count, kgG: total, batches: results };
  });
}

// ---------------------------------------------------------------- labels

/** Label queue = every roll whose label hasn't been scanned in yet (new rolls and cut pieces). */
export async function labelQueue() {
  return db.select({ r: rolls, f: fabricItems, b: batches, l: locations }).from(rolls)
    .innerJoin(fabricItems, eq(fabricItems.id, rolls.fabricItemId)).innerJoin(batches, eq(batches.id, rolls.batchId))
    .innerJoin(locations, eq(locations.id, rolls.currentLocationId))
    .where(and(sql`${rolls.labelActivatedAt} is null`, sql`${rolls.status} <> 'FINISHED'`)).orderBy(asc(rolls.createdAt));
}
/** Printing records when a label was printed; the roll stays in the queue until its label is scanned. */
export async function markLabelsPrinted(u: CurrentUser, rollIds: string[]) {
  if (u.role !== "ADMIN") throw new UserError("Only the admin prints labels.");
  return db.transaction(async (tx) => {
    const list = await tx.select().from(rolls).where(inArray(rolls.id, rollIds));
    for (const r of list) await tx.update(rolls).set({ labelPrintedAt: new Date(), labelPrintedBy: u.email }).where(eq(rolls.id, r.id));
    await writeAudit(tx, u, "LABELS_PRINTED", "labels", null, { rollSerials: list.map((r) => r.serial).join(","), details: { n: list.length } });
    return list.length;
  });
}
export async function lookupForActivate(serialRaw: string) {
  const serial = serialOf(serialRaw);
  const [row] = await db.select({ r: rolls, f: fabricItems, b: batches, l: locations }).from(rolls)
    .innerJoin(fabricItems, eq(fabricItems.id, rolls.fabricItemId)).innerJoin(batches, eq(batches.id, rolls.batchId))
    .innerJoin(locations, eq(locations.id, rolls.currentLocationId)).where(eq(rolls.serial, serial));
  if (!row) return { ok: false, serial, error: "No roll with this serial" };
  const card = { serial, fabricNo: row.f.fabricNo, fabric: row.f.cwFabricCode ?? row.f.itemName, colour: row.f.colour, batch: row.b.code, remainingG: row.r.remainingG, location: row.l.name };
  if (row.r.labelActivatedAt) return { ok: false, ...card, error: `Label already scanned in (${row.r.status === "IN_STOCK" ? "In stock" : row.r.status.toLowerCase()})` };
  if (row.r.status === "FINISHED") return { ok: false, ...card, error: "Roll is finished" };
  return { ok: true, ...card };
}
export async function activateLabels(u: CurrentUser, serials: string[]) {
  if (!["ADMIN", "INVENTORY"].includes(u.role)) throw new UserError("Only Inventory or Admin activate labels.");
  return db.transaction(async (tx) => {
    await lock(tx);
    const list = await tx.select().from(rolls).where(inArray(rolls.serial, serials.map(serialOf))).for("update");
    const done: string[] = [];
    for (const r of list) {
      if (r.labelActivatedAt || r.status === "FINISHED") continue;
      if (!canPostLocation(u, r.currentLocationId)) throw new UserError(`${r.serial}: you may not post for this roll's location.`);
      await tx.update(rolls).set({ labelActivatedAt: new Date(), status: "IN_STOCK" }).where(eq(rolls.id, r.id));
      done.push(r.serial);
    }
    await writeAudit(tx, u, "LABELS_ACTIVATED", "labels", null, { rollSerials: done.join(","), details: { n: done.length } });
    return done.length;
  });
}

// ---------------------------------------------------------------- transfer (TROR) and consumption (TROC) orders

export type TOLineInput = { item: string; kg?: string | number; waste?: string | number; pieces?: string | number; orders?: string[]; serials?: string[] };
export type TOInput = {
  type: TOType; date: string; sourceId: string; destinationId: string; stylePO?: string; mo?: string; invoice?: string; reason?: string;
  lines: TOLineInput[];
  /** an order number on this TROC was already used for the same fabric: "recut" adds _recut to it, "not-recut" keeps it */
  recut?: "recut" | "not-recut";
  /** internal: the planned TROR being dispatched (its picked rolls may be used) */
  forTO?: string;
  /** internal: planning a TROR (whole plan, nothing reserved yet) */
  planning?: boolean;
};
export type Dup = { row: number; order: string; prevTO: string; suggestion: string };
type Take = { roll: Roll; kgG: number; wasteG: number; cut: boolean; rack: string | null };
export type RowPlan = {
  row: number; item: string; fabric: { id: string; fabricNo: string; label: string; sku: string | null } | null;
  haveG: number; waitingG: number; destG: number | null; needG: number; wasteG: number; pieces: number; orders: string[];
  takes: { serial: string; kgG: number; wasteG: number; cut: boolean; rack: string | null; rollLeftG: number; batch: string }[];
  error: string | null; scanned: boolean;
  /** consumption: the scanned roll's invoice / batch / what it was taken out for */
  roll?: { serial: string; invoice: string | null; batch: string; leftG: number; takenOutFor: string | null; purpose: string | null } | null;
};

/** Works out exactly which rolls an order takes (oldest first, or the scanned ones). Used for the live pick list and for posting. */
async function planTO(tx: Tx, u: CurrentUser, p: TOInput, forUpdate: boolean) {
  const type: TOType = p.type === "CONSUMPTION" ? "CONSUMPTION" : "TRANSFER";
  const errs: string[] = [];
  const locs = await allLocations(tx);
  const src = locs.find((l) => l.id === p.sourceId), dst = locs.find((l) => l.id === p.destinationId);
  const prod = locs.filter(isProd);
  if (!src) errs.push("Pick a source location.");
  if (!dst) errs.push("Pick a destination location.");
  if (src && dst && src.id === dst.id) errs.push("Source and destination must differ.");
  if (isProd(src)) errs.push(`${src!.name} is a production location: fabric there is already cloth and can't be moved or used again.`);
  if (type === "TRANSFER" && isProd(dst)) errs.push(`Fabric sent to ${dst!.name} is turned into cloth: post it as a consumption order (TROC), not a transfer.`);
  if (type === "CONSUMPTION" && prod.length && dst && !isProd(dst)) errs.push(`A consumption order goes to a production location (${prod.map((l) => l.name).join(", ")}).`);
  if (src && !canPostLocation(u, src.id)) errs.push(`You may not post from ${src.name}.`);
  let stylePO = "";
  if (type === "CONSUMPTION") {
    stylePO = String(p.stylePO || "").trim().toUpperCase();
    if (!FMT.stylePO.test(stylePO)) errs.push("Style PO must look like CT26/PO/88 or PO-112.");
    else if (!canUseStylePO(u, stylePO)) errs.push(`You may not post against ${stylePO}.`);
  }
  const lines = (p.lines || []).filter((l) => String(l.item || "").trim() || toG(l.kg ?? "") > 0 || toG(l.waste ?? "") > 0 || (l.serials?.length ?? 0) > 0);
  if (!lines.length) errs.push("Add at least one item.");
  const fabrics = await tx.select().from(fabricItems).where(eq(fabricItems.active, true));
  const rackCodes = new Map((await tx.select({ id: racks.id, code: racks.code }).from(racks)).map((r) => [r.id, r.code]));
  const batchCodes = new Map<string, string>();
  const left = new Map<string, number>();
  const plans: RowPlan[] = [];
  const takes: Take[][] = [];
  for (const [i, l] of lines.entries()) {
    const n = `Row ${i + 1}: `;
    const rp: RowPlan = { row: i + 1, item: l.item, fabric: null, haveG: 0, waitingG: 0, destG: null, needG: 0, wasteG: 0, pieces: 0, orders: [], takes: [], error: null, scanned: !!l.serials?.length };
    plans.push(rp); takes.push([]);
    const fail = (m: string) => { rp.error = m; errs.push(n + m); };
    const scanned = (l.serials ?? []).map(serialOf).filter(Boolean);
    let f = resolveFabric(fabrics, l.item);
    let scanRolls: Roll[] = [];
    if (scanned.length) {
      const q = tx.select().from(rolls).where(inArray(rolls.serial, scanned));
      scanRolls = forUpdate ? await q.for("update") : await q;
      const missing = scanned.filter((s) => !scanRolls.some((r) => r.serial === s));
      if (missing.length) { fail(`no roll ${missing.join(", ")}.`); continue; }
      scanRolls.sort((a, b) => scanned.indexOf(a.serial) - scanned.indexOf(b.serial));
      if (!f) f = fabrics.find((x) => x.id === scanRolls[0].fabricItemId) ?? null;
      const other = scanRolls.find((r) => r.fabricItemId !== f?.id);
      if (other) { fail(`${other.serial} is a different fabric from this row. Put it on its own row.`); continue; }
    }
    if (type === "CONSUMPTION" && !scanned.length) { fail("scan the roll's barcode. A TROC uses the exact rolls taken out for production."); continue; }
    if (!f) { fail(`no fabric "${String(l.item || "").trim()}" in Fabric Inventory. Use the Rajdanga Fabric # or the SKU.`); continue; }
    rp.fabric = { id: f.id, fabricNo: f.fabricNo ?? "", label: `${f.cwFabricCode ?? f.itemName}${f.colour ? " · " + f.colour : ""}`, sku: f.sku };
    const wasteG = type === "CONSUMPTION" ? toG(l.waste || 0) : 0;
    rp.wasteG = Number.isNaN(wasteG) ? 0 : wasteG;
    if (type === "CONSUMPTION") {
      const pc = Number(l.pieces || 0);
      const ords = (l.orders || []).map((o) => String(o || "").trim()).filter(Boolean);
      if (!(pc >= 0) || pc !== Math.round(pc)) errs.push(n + "pieces must be a whole number.");
      else if (pc > 0 && ords.length !== pc) errs.push(n + `enter one order number per piece: ${ords.length} of ${pc}.`);
      else if (!pc && ords.length) errs.push(n + "order numbers are filled in but pieces is empty.");
      rp.pieces = pc > 0 ? pc : 0; rp.orders = pc > 0 ? ords : [];
    }
    if (!src) continue;
    const poolQ = tx.select().from(rolls).where(and(eq(rolls.fabricItemId, f.id), eq(rolls.currentLocationId, src.id), eq(rolls.status, "IN_STOCK"), sql`${rolls.takenOutAt} is null`))
      .orderBy(asc(rolls.registeredDate), asc(rolls.createdAt), asc(rolls.serial));
    const fifo = forUpdate ? await poolQ.for("update") : await poolQ;
    for (const r of fifo) if (!left.has(r.id)) left.set(r.id, r.remainingG);
    rp.haveG = fifo.reduce((a, r) => a + Math.max(0, left.get(r.id)!), 0);
    const [w] = await tx.select({ g: sql<number>`coalesce(sum(${rolls.remainingG}),0)::int` }).from(rolls)
      .where(and(eq(rolls.fabricItemId, f.id), eq(rolls.currentLocationId, src.id), eq(rolls.status, "AWAITING_LABEL")));
    rp.waitingG = Number(w?.g ?? 0);
    if (dst) rp.destG = await stockAt(tx, f.id, dst.id);

    let pool = fifo;
    if (scanned.length) {
      for (const r of scanRolls) {
        if (r.status === "AWAITING_LABEL") { fail(`${r.serial}: label not activated yet — activate it or put it away first.`); break; }
        if (r.status === "FINISHED") { fail(`${r.serial} is finished (0 kg left).`); break; }
        if (r.currentLocationId !== src.id) { fail(`${r.serial} is at ${locs.find((x) => x.id === r.currentLocationId)?.name}, not ${src.name}.`); break; }
        if (type === "CONSUMPTION" && !(r.takenOutAt && (r.takenOutPurpose === "PRODUCTION" || r.takenOutPurpose === "SAMPLING"))) {
          fail(`${r.serial} hasn't been taken out for production. Take it out first (Warehouse → Take out for production), then make the TROC.`); break;
        }
        if (type === "TRANSFER" && r.takenOutAt && !(r.takenOutPurpose === "TROR" && r.takenOutFor === p.forTO)) {
          fail(`${r.serial} is taken out for ${r.takenOutPurpose === "TROR" ? r.takenOutFor : `production (${r.takenOutFor ?? ""})`}.`); break;
        }
        if (!left.has(r.id)) left.set(r.id, r.remainingG);
      }
      if (rp.error) continue;
      pool = scanRolls;
      if (type === "CONSUMPTION" && scanRolls.length === 1) {
        const r0 = scanRolls[0];
        const [b0] = await tx.select({ c: batches.code }).from(batches).where(eq(batches.id, r0.batchId));
        rp.roll = { serial: r0.serial, invoice: r0.invoiceNo, batch: b0?.c ?? "", leftG: r0.remainingG, takenOutFor: r0.takenOutFor, purpose: r0.takenOutPurpose };
      }
    }
    let kgG = toG(l.kg ?? "");
    if (scanned.length && type === "TRANSFER" && !(kgG > 0)) kgG = pool.reduce((a, r) => a + Math.max(0, left.get(r.id)!), 0);
    rp.needG = Number.isNaN(kgG) ? 0 : kgG;
    if (!(kgG > 0)) { fail(type === "CONSUMPTION" ? "kg used must be above 0." : "transfer quantity must be above 0."); continue; }
    if (wasteG < 0 || Number.isNaN(wasteG)) { fail("waste can't be negative."); continue; }
    let avail = pool.reduce((a, r) => a + Math.max(0, left.get(r.id)!), 0);
    if (p.planning && type === "TRANSFER") {
      const [res] = (await tx.execute(sql`select coalesce(sum(i.kg_g),0)::int g from to_items i join transfer_orders t on t.id = i.to_id
        where t.status = 'PLANNED' and t.source_location_id = ${src.id} and i.fabric_item_id = ${f.id}`)).rows as { g: number }[];
      if (res.g > 0) {
        avail -= res.g;
        if (kgG > avail + TOL) { fail(`${f.fabricNo} has ${fmtKg(avail + res.g)} kg at ${src.name}, but ${fmtKg(res.g)} kg of it is already on other open TRORs. Free: ${fmtKg(Math.max(0, avail))} kg.`); continue; }
      }
    }
    if (kgG + wasteG > avail + TOL) {
      fail(scanned.length ? `the scanned rolls hold only ${fmtKg(avail)} kg.`
        : `${f.fabricNo} has only ${fmtKg(avail)} kg in stock at ${src.name}${rp.waitingG ? ` (${fmtKg(rp.waitingG, 1)} kg more is waiting for labels to be activated)` : ""}.`);
      continue;
    }
    const t: Take[] = [];
    if (type === "TRANSFER") {
      let need = kgG;
      for (const r of pool) {
        if (need <= 5) break;
        const have = left.get(r.id)!; if (have <= 5) continue;
        if (have <= need + TOL) { t.push({ roll: r, kgG: have, wasteG: 0, cut: false, rack: r.rackId ? rackCodes.get(r.rackId) ?? null : null }); left.set(r.id, 0); need -= have; }
        else { t.push({ roll: r, kgG: need, wasteG: 0, cut: true, rack: r.rackId ? rackCodes.get(r.rackId) ?? null : null }); left.set(r.id, have - need); need = 0; }
      }
    } else {
      let nk = kgG, nw = wasteG;
      for (const r of pool) {
        if (nk <= 5 && nw <= 5) break;
        let a = left.get(r.id)!; if (a <= 5) continue;
        const tk = Math.min(a, nk); a -= tk; const tw = Math.min(a, nw); a -= tw;
        if (tk + tw > 0) { t.push({ roll: r, kgG: tk, wasteG: tw, cut: false, rack: r.rackId ? rackCodes.get(r.rackId) ?? null : null }); nk -= tk; nw -= tw; left.set(r.id, a); }
      }
    }
    takes[i] = t;
    for (const x of t) {
      if (!batchCodes.has(x.roll.batchId)) batchCodes.set(x.roll.batchId, (await tx.select({ c: batches.code }).from(batches).where(eq(batches.id, x.roll.batchId)))[0]?.c ?? "");
      rp.takes.push({ serial: x.roll.serial, kgG: x.kgG, wasteG: x.wasteG, cut: x.cut, rack: x.rack, rollLeftG: left.get(x.roll.id)!, batch: batchCodes.get(x.roll.batchId)! });
    }
  }
  // an order number already used for the same fabric on an earlier TROC: is this a recut?
  const dups: Dup[] = [];
  if (type === "CONSUMPTION") {
    const wanted = plans.flatMap((rp) => rp.fabric ? rp.orders.map((o) => ({ row: rp.row, order: o.toUpperCase(), fno: rp.fabric!.fabricNo })) : []);
    const bases = [...new Set(wanted.map((w) => w.order.replace(/_RECUT\d*$/, "")))];
    if (bases.length) {
      const prev = (await tx.execute(sql`select upper(o.order_number) ord, o.fabric_no, t.to_number from order_links o join transfer_orders t on t.id = o.to_id
        where not o.reversed and (${sql.join(bases.map((b) => sql`upper(o.order_number) like ${b + "%"}`), sql` or `)})`)).rows as { ord: string; fabric_no: string; to_number: string }[];
      const seen = new Set<string>();
      for (const w of wanted) {
        const hit = prev.find((x) => x.ord === w.order && x.fabric_no === w.fno);
        if (!hit || seen.has(w.row + w.order)) continue;
        seen.add(w.row + w.order);
        const base = w.order.replace(/_RECUT\d*$/, "");
        const usedNames = new Set(prev.filter((x) => x.fabric_no === w.fno).map((x) => x.ord));
        let sug = `${base}_recut`;
        for (let k = 2; usedNames.has(sug.toUpperCase()); k++) sug = `${base}_recut${k}`;
        dups.push({ row: w.row, order: w.order, prevTO: hit.to_number, suggestion: sug });
      }
    }
  }
  return { type, errs, src, dst, stylePO, lines, plans, takes, batchCodes, fabrics, dups };
}

/** Live pick list for the order form (nothing is written). */
export async function previewTO(u: CurrentUser, p: TOInput) {
  return db.transaction(async (tx) => {
    const r = await planTO(tx, u, p, false);
    return { errors: r.errs, rows: r.plans, next: await peekNextTO(r.type), dups: r.dups };
  });
}

export type PostTOResult = { ok: false; errors: string[]; dups?: Dup[] } | { ok: true; to: string; lines: number; kgG: number; pieces: number; cuts: { from: string; piece: string; kgG: number }[]; next: string; pick: RowPlan[] };

export async function postTO(u: CurrentUser, p: TOInput, existing?: { id: string; toNumber: string }): Promise<PostTOResult> {
  const type: TOType = p.type === "CONSUMPTION" ? "CONSUMPTION" : "TRANSFER";
  if (type === "TRANSFER" && !["ADMIN", "INVENTORY"].includes(u.role)) throw new UserError("Only Inventory or Admin post transfer orders.");
  if (type === "CONSUMPTION" && !["ADMIN", "MERCHANDISER"].includes(u.role)) throw new UserError("Only Merchandisers or Admin post consumption orders.");
  const date = String(p.date || "");
  const res = await db.transaction(async (tx) => {
    await lock(tx);
    const errs0: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayIST()) errs0.push("Date must be today or earlier.");
    const plan = await planTO(tx, u, { ...p, forTO: existing?.toNumber }, true);
    const errs = [...errs0, ...plan.errs];
    if (errs.length) return { ok: false as const, errors: errs };
    if (plan.dups.length) {
      if (!p.recut) return { ok: false as const, dups: plan.dups,
        errors: plan.dups.map((d) => `Order ${d.order} already used ${plan.plans[d.row - 1]?.fabric?.fabricNo} on ${d.prevTO}. Is this a recut?`) };
      if (p.recut === "recut") for (const d of plan.dups) {
        const rp = plan.plans[d.row - 1];
        rp.orders = rp.orders.map((o) => (o.toUpperCase() === d.order ? d.suggestion : o));
      }
    }
    const { src, dst, stylePO, plans, takes } = plan;
    const pieces = plans.reduce((a, r) => a + r.pieces, 0);
    const vals = {
      type, date, reason: p.reason?.trim().slice(0, 500) || null, sourceLocationId: src!.id, destLocationId: dst!.id,
      destAddress: dst!.address, stylePO: stylePO || null, moNumber: p.mo?.trim() || null, taxInvoiceNo: p.invoice?.trim() || null,
      postedBy: u.email, piecesMade: pieces || null,
    };
    let to: string;
    let head: typeof transferOrders.$inferSelect;
    if (existing) {
      const [cur] = await tx.select().from(transferOrders).where(eq(transferOrders.id, existing.id)).for("update");
      if (!cur || cur.status !== "PLANNED") return { ok: false as const, errors: [`${existing.toNumber} is not waiting to be dispatched.`] };
      to = cur.toNumber;
      [head] = await tx.update(transferOrders).set({ ...vals, reason: vals.reason ?? cur.reason, moNumber: vals.moNumber ?? cur.moNumber, taxInvoiceNo: vals.taxInvoiceNo ?? cur.taxInvoiceNo,
        status: "POSTED", postedAt: new Date() }).where(eq(transferOrders.id, cur.id)).returning();
      await tx.delete(toItems).where(eq(toItems.toId, cur.id));
    } else {
      to = await takeNumber(tx, type);
      [head] = await tx.insert(transferOrders).values({ toNumber: to, ...vals }).returning();
    }
    const cuts: { from: string; piece: string; kgG: number }[] = [];
    let kgTotal = 0, nLines = 0;
    const current = new Map<string, Roll>();
    for (const [i, rp] of plans.entries()) {
      await tx.insert(toItems).values({ toId: head.id, rowNo: rp.row, fabricItemId: rp.fabric!.id, kgG: rp.needG, wasteG: rp.wasteG, pieces: rp.pieces || null, pick: rp.scanned ? "SCAN" : "FIFO" });
      const rowSerials: string[] = [];
      let rowKg = 0;
      for (const x of takes[i]) {
        const r = current.get(x.roll.id) ?? (await tx.select().from(rolls).where(eq(rolls.id, x.roll.id)))[0];
        const sb = await stockAt(tx, r.fabricItemId, src!.id);
        const dbk = await stockAt(tx, r.fabricItemId, dst!.id);
        const bc = plan.batchCodes.get(r.batchId)!;
        const fno = rp.fabric!.fabricNo;
        if (type === "TRANSFER" && x.cut) {
          const newSerial = await serialMaker(tx, fno);
          const serial = await newSerial(`Cut piece on ${to}`);
          const [piece] = await tx.insert(rolls).values({
            serial, batchId: r.batchId, fabricItemId: r.fabricItemId, fabricPO: r.fabricPO, registeredDate: todayIST(), registeredLocationId: src!.id,
            weighedG: x.kgG, weighedBy: `Cut from ${r.serial}`, registeredBy: u.email, currentLocationId: dst!.id, remainingG: x.kgG,
            status: "IN_STOCK", splitFromId: r.id, lastMovement: to, notes: `Cut piece on ${to}`, invoiceNo: r.invoiceNo, receiptId: r.receiptId,
          }).returning();
          const upd = { ...r, splitG: r.splitG + x.kgG };
          const rem = remOf(upd);
          await tx.update(rolls).set({ splitG: upd.splitG, remainingG: rem, status: statusFor(r, rem), lastMovement: to }).where(eq(rolls.id, r.id));
          current.set(r.id, { ...upd, remainingG: rem });
          await rackOnLocationChange(tx, u, { ...piece, rackId: null, lastRackId: null }, src!.id, dst!.id, to);
          await tx.insert(toLines).values({ toId: head.id, rollId: piece.id, batchCode: bc, fabricNo: fno, kgG: x.kgG, sourceBeforeG: sb, sourceAfterG: sb - x.kgG,
            destBeforeG: dbk, destAfterG: dbk + x.kgG, rollBeforeG: r.remainingG, rollAfterG: rem, itemRow: rp.row, cutFromSerial: r.serial, rackCode: x.rack });
          cuts.push({ from: r.serial, piece: serial, kgG: x.kgG });
          rowSerials.push(serial);
        } else if (type === "TRANSFER") {
          await tx.update(rolls).set({ currentLocationId: dst!.id, lastMovement: to, takenOutAt: null, takenOutBy: null, takenOutPurpose: null, takenOutFor: null }).where(eq(rolls.id, r.id));
          await rackOnLocationChange(tx, u, r, src!.id, dst!.id, to);
          await tx.insert(toLines).values({ toId: head.id, rollId: r.id, batchCode: bc, fabricNo: fno, kgG: x.kgG, sourceBeforeG: sb, sourceAfterG: sb - x.kgG,
            destBeforeG: dbk, destAfterG: dbk + x.kgG, rollBeforeG: r.remainingG, rollAfterG: r.remainingG, itemRow: rp.row, rackCode: x.rack });
          rowSerials.push(r.serial);
        } else {
          const upd = { ...r, consumedG: r.consumedG + x.kgG + x.wasteG };
          const rem = remOf(upd);
          await tx.update(rolls).set({ consumedG: upd.consumedG, remainingG: rem, status: statusFor(r, rem), lastMovement: to }).where(eq(rolls.id, r.id));
          current.set(r.id, { ...upd, remainingG: rem });
          await rackOnKgChange(tx, u, r, rem, to);
          await tx.insert(toLines).values({ toId: head.id, rollId: r.id, batchCode: bc, fabricNo: fno, kgG: x.kgG, wasteG: x.wasteG, sourceBeforeG: sb,
            sourceAfterG: sb - x.kgG - x.wasteG, destBeforeG: dbk, destAfterG: dbk, rollBeforeG: r.remainingG, rollAfterG: rem, itemRow: rp.row, rackCode: x.rack });
          rowSerials.push(r.serial);
        }
        rowKg += x.kgG; kgTotal += x.kgG + x.wasteG; nLines++;
      }
      if (rp.pieces) {
        const f = plan.fabrics.find((x) => x.id === rp.fabric!.id)!;
        await tx.insert(orderLinks).values(rp.orders.map((o, j) => ({
          toId: head.id, pieceIndex: j + 1, rollSerials: rowSerials.join(", "), stylePO, orderNumber: o, itemRow: rp.row,
          fabricNo: f.fabricNo, colour: `${f.cwFabricCode ?? ""} ${f.colour ?? ""}`.trim(), kgPerPieceG: Math.round(rowKg / rp.pieces),
        })));
      }
    }
    await writeAudit(tx, u, type === "TRANSFER" ? "POST_TRANSFER" : "POST_CONSUMPTION", "to", head.id, {
      details: { to, source: src!.name, destination: dst!.name, stylePO, items: plans.map((r) => [r.fabric?.fabricNo, r.needG, r.wasteG]), cuts, pieces: plans.map((r) => [r.row, r.pieces, r.orders]) },
    });
    await tx.delete(schema.drafts).where(and(eq(schema.drafts.userId, u.id), eq(schema.drafts.kind, type)));
    return { ok: true as const, to, lines: nLines, kgG: kgTotal, pieces, cuts, pick: plans };
  });
  if (!res.ok) return res;
  return { ...res, next: await peekNextTO(type) };
}

// ---------------------------------------------------------------- reversal

/** Never deletes: writes mirror lines under the next number, marked "Reversal of". */
export async function reverseTO(u: CurrentUser, toNumberRaw: string, reasonRaw: string) {
  if (!["ADMIN", "INVENTORY", "MERCHANDISER"].includes(u.role)) throw new UserError("Your role can't reverse orders.");
  const reason = String(reasonRaw || "").trim();
  if (!reason) throw new UserError("Give a reason for the reversal.");
  const settings = await getSettings();
  return db.transaction(async (tx) => {
    await lock(tx);
    const toNo = toNumberRaw.trim().toUpperCase();
    const [to] = await tx.select().from(transferOrders).where(eq(transferOrders.toNumber, toNo)).for("update");
    if (!to) throw new UserError(`No posted TO ${toNo}.`);
    if (to.status !== "POSTED") throw new UserError(`${toNo} hasn't been dispatched yet${to.status === "PLANNED" ? " — cancel the plan instead" : ""}.`);
    if (to.isReversal) {
      const [o] = await tx.select().from(transferOrders).where(eq(transferOrders.id, to.reversalOfId!));
      throw new UserError(`${toNo} is itself a reversal (of ${o?.toNumber}).`);
    }
    const [done] = await tx.select().from(transferOrders).where(eq(transferOrders.reversalOfId, to.id));
    if (done) throw new UserError(`${toNo} is already reversed by ${done.toNumber}.`);
    if (u.role !== "ADMIN") {
      if (to.postedBy !== u.email) throw new UserError("Only the Admin can reverse someone else's TO.");
      if ((Date.now() - to.postedAt.getTime()) / 60000 > Number(settings.undoMinutes)) throw new UserError(`More than ${settings.undoMinutes} minutes have passed. Ask the Admin.`);
    }
    const lines = await tx.select().from(toLines).where(eq(toLines.toId, to.id)).orderBy(asc(toLines.itemRow));
    const rollList = await tx.select().from(rolls).where(inArray(rolls.id, lines.map((l) => l.rollId))).for("update");
    const byId = new Map(rollList.map((r) => [r.id, r]));
    for (const l of lines) {
      const r = byId.get(l.rollId)!;
      if (to.type === "TRANSFER" && r.currentLocationId !== to.destLocationId) throw new UserError(`${r.serial} has moved again since ${toNo}; reverse the later TO first.`);
      if (to.type === "TRANSFER" && r.splitFromId && (r.consumedG > 0 || r.splitG > 0)) throw new UserError(`${r.serial} (cut on ${toNo}) has been used since; reverse that first.`);
    }
    const rev = await takeNumber(tx, to.type);
    const [head] = await tx.insert(transferOrders).values({
      toNumber: rev, type: to.type, date: todayIST(), reason: `Reversal of ${toNo}: ${reason}`, sourceLocationId: to.destLocationId, destLocationId: to.sourceLocationId,
      stylePO: to.stylePO, moNumber: to.moNumber, taxInvoiceNo: to.taxInvoiceNo, postedBy: u.email, isReversal: true, reversalOfId: to.id, reversalReason: reason,
      piecesMade: to.piecesMade ? -to.piecesMade : null,
    }).returning();
    for (const l of lines) {
      const r = byId.get(l.rollId)!;
      let after = r.remainingG;
      if (to.type === "TRANSFER") {
        await tx.update(rolls).set({ currentLocationId: to.sourceLocationId, lastMovement: `${rev} (reverses ${toNo})` }).where(eq(rolls.id, r.id));
        await rackOnLocationChange(tx, u, r, to.destLocationId, to.sourceLocationId, rev);
      } else {
        const upd = { ...r, consumedG: r.consumedG - l.kgG - l.wasteG };
        after = remOf(upd);
        await tx.update(rolls).set({ consumedG: upd.consumedG, remainingG: after, status: statusFor(r, after), lastMovement: `${rev} (reverses ${toNo})` }).where(eq(rolls.id, r.id));
        await rackOnKgChange(tx, u, r, after, rev);
      }
      await tx.insert(toLines).values({ toId: head.id, rollId: r.id, batchCode: l.batchCode, fabricNo: l.fabricNo, kgG: -l.kgG, wasteG: -l.wasteG,
        sourceBeforeG: l.destAfterG, sourceAfterG: l.destBeforeG, destBeforeG: l.sourceAfterG, destAfterG: l.sourceBeforeG,
        rollBeforeG: r.remainingG, rollAfterG: after, itemRow: l.itemRow, cutFromSerial: l.cutFromSerial });
    }
    await tx.update(orderLinks).set({ reversed: true }).where(eq(orderLinks.toId, to.id));
    await writeAudit(tx, u, "REVERSE_TO", "to", to.id, { rollSerials: rollList.map((r) => r.serial).join(","), details: { reversed: toNo, by: rev, reason, lines: lines.length } });
    return { reversed: toNo, by: rev, lines: lines.length };
  });
}

export async function setEnteredInZoho(u: CurrentUser, toId: string, value: boolean) {
  return db.transaction(async (tx) => {
    const [to] = await tx.select().from(transferOrders).where(eq(transferOrders.id, toId));
    if (!to) throw new UserError("No such TO.");
    if (u.role === "VIEWER") throw new UserError("Viewers can't change this.");
    await tx.update(transferOrders).set({ enteredInZoho: value, enteredInZohoAt: value ? new Date() : null, enteredInZohoBy: value ? u.email : null }).where(eq(transferOrders.id, toId));
    await writeAudit(tx, u, value ? "ZOHO_TICKED" : "ZOHO_UNTICKED", "to", to.id, { details: { to: to.toNumber } });
  });
}

// ---------------------------------------------------------------- adjustments

export async function approvalThresholdG(weighedG: number) {
  const s = await getSettings();
  const a = Math.round(Number(s.adjLimitKg) * 1000);
  const b = Math.round((weighedG * Number(s.adjLimitPct)) / 100);
  return s.adjLimitRule === "LARGER" ? Math.max(a, b) : Math.min(a, b);
}
async function applyAdjustment(tx: Tx, adjId: string, kgChangeG: number, rollId: string, u: { email: string }, ref: string) {
  const [r] = await tx.select().from(rolls).where(eq(rolls.id, rollId)).for("update");
  const upd = { ...r, adjustedG: r.adjustedG + kgChangeG };
  const rem = remOf(upd);
  if (rem < -TOL) throw new UserError(`${r.serial}: the roll would go below 0 kg (it has ${fmtKg(r.remainingG)} kg).`);
  await tx.update(rolls).set({ adjustedG: upd.adjustedG, remainingG: rem, status: statusFor(r, rem) }).where(eq(rolls.id, r.id));
  await rackOnKgChange(tx, u, r, rem, ref);
  await tx.update(adjustments).set({ rollBeforeG: r.remainingG, rollAfterG: rem }).where(eq(adjustments.id, adjId));
  return { before: r.remainingG, after: rem, serial: r.serial };
}
async function adjNumber(tx: Tx) {
  const d = todayIST().replaceAll("-", "").slice(2);
  return `ADJ-${d}-${String(await nextCounter(tx, "adjustment")).padStart(4, "0")}`;
}
export async function requestAdjustment(u: CurrentUser, input: { serial: string; kgChangeG: number; reason: AdjReason; note?: string; photoUrl?: string }) {
  if (!["ADMIN", "INVENTORY"].includes(u.role)) throw new UserError("Only Inventory or Admin can adjust.");
  const serial = serialOf(input.serial);
  if (!Number.isInteger(input.kgChangeG) || input.kgChangeG === 0) throw new UserError("Kg change can't be 0.");
  if (!(input.reason in REASONS)) throw new UserError("Pick a reason.");
  const note = input.note?.trim() || "";
  return db.transaction(async (tx) => {
    await lock(tx);
    const [r] = await tx.select().from(rolls).where(eq(rolls.serial, serial)).for("update");
    if (!r) throw new UserError("No roll with that serial.");
    if (!canPostLocation(u, r.currentLocationId)) throw new UserError("You may not adjust rolls at this roll's location.");
    const limit = await approvalThresholdG(r.weighedG);
    const big = Math.abs(input.kgChangeG) > limit;
    if ((input.reason === "OTHER" || big) && !note) throw new UserError(`A note is needed for "Other" and for changes above ${fmtKg(limit)} kg.`);
    if (r.remainingG + input.kgChangeG < -TOL) throw new UserError(`The roll would go below 0 kg (it has ${fmtKg(r.remainingG)} kg).`);
    const needsApproval = big && u.role !== "ADMIN";
    const number = await adjNumber(tx);
    const [adj] = await tx.insert(adjustments).values({
      number, rollId: r.id, kgChangeG: input.kgChangeG, reason: input.reason, note: note || null, photoUrl: input.photoUrl?.trim() || null,
      status: needsApproval ? "PENDING" : "APPROVED", requestedBy: u.email,
      ...(needsApproval ? {} : { decidedBy: `${u.email}${big ? " (admin)" : " (within limit)"}`, decidedAt: new Date() }),
    }).returning();
    let res = { before: r.remainingG, after: r.remainingG };
    if (!needsApproval) res = await applyAdjustment(tx, adj.id, input.kgChangeG, r.id, u, number);
    await writeAudit(tx, u, "ADJUST", "adjustment", adj.id, { rollSerials: serial, kgBeforeG: res.before, kgAfterG: res.after, details: { number, delta: input.kgChangeG, reason: input.reason, status: adj.status } });
    return { number, status: adj.status, limitG: limit };
  });
}
export async function decideAdjustment(u: CurrentUser, adjId: string, approve: boolean, noteRaw: string) {
  if (u.role !== "ADMIN") throw new UserError("Only the admin approves adjustments.");
  return db.transaction(async (tx) => {
    await lock(tx);
    const [a] = await tx.select().from(adjustments).where(eq(adjustments.id, adjId)).for("update");
    if (!a || a.status !== "PENDING") throw new UserError("Not pending any more.");
    if (a.requestedBy === u.email) throw new UserError("You can't decide your own adjustment.");
    let res: { before?: number; after?: number; serial?: string } = {};
    if (approve) res = await applyAdjustment(tx, a.id, a.kgChangeG, a.rollId, u, a.number);
    await tx.update(adjustments).set({ status: approve ? "APPROVED" : "REJECTED", decidedBy: u.email, decidedAt: new Date(), decisionNote: noteRaw.trim() || null }).where(eq(adjustments.id, a.id));
    await writeAudit(tx, u, approve ? "APPROVE" : "REJECT", "adjustment", a.id, { rollSerials: res.serial, kgBeforeG: res.before, kgAfterG: res.after, details: { number: a.number, note: noteRaw } });
  });
}
export async function reverseAdjustment(u: CurrentUser, adjId: string, reasonRaw: string) {
  if (u.role !== "ADMIN") throw new UserError("Only the admin can reverse an adjustment.");
  const reason = reasonRaw.trim();
  if (!reason) throw new UserError("A reason is required.");
  return db.transaction(async (tx) => {
    await lock(tx);
    const [a] = await tx.select().from(adjustments).where(eq(adjustments.id, adjId));
    if (!a || a.status !== "APPROVED") throw new UserError("Only an approved adjustment can be reversed.");
    const [dup] = await tx.select({ id: adjustments.id }).from(adjustments).where(eq(adjustments.reversalOfId, a.id));
    if (dup) throw new UserError(`${a.number} is already reversed.`);
    const number = await adjNumber(tx);
    const [rev] = await tx.insert(adjustments).values({ number, rollId: a.rollId, kgChangeG: -a.kgChangeG, reason: a.reason, note: `Reversal of ${a.number}: ${reason}`,
      status: "APPROVED", requestedBy: u.email, decidedBy: u.email, decidedAt: new Date(), reversalOfId: a.id }).returning();
    const res = await applyAdjustment(tx, rev.id, -a.kgChangeG, a.rollId, u, number);
    await writeAudit(tx, u, "ADJ_REVERSED", "adjustment", a.id, { rollSerials: res.serial, kgBeforeG: res.before, kgAfterG: res.after, details: { number: a.number, reversal: number, reason } });
    return { number };
  });
}

// ---------------------------------------------------------------- rebuild balances from the logs

/** Recomputes every roll's location, consumed, adjusted, cut-off and remaining kg from the logs, fixes differences and reports them. */
export async function rebuildRolls(u: CurrentUser) {
  if (u.role !== "ADMIN") throw new UserError("Only the admin can rebuild.");
  return db.transaction(async (tx) => {
    await lock(tx);
    const all = await tx.select().from(rolls);
    const lines = await tx.select({ l: toLines, t: transferOrders }).from(toLines).innerJoin(transferOrders, eq(transferOrders.id, toLines.toId)).orderBy(asc(transferOrders.postedAt));
    const adj = await tx.select().from(adjustments).where(eq(adjustments.status, "APPROVED"));
    const st = new Map(all.map((r) => [r.id, { loc: r.registeredLocationId, consumed: 0, adjusted: 0, split: 0 }]));
    for (const r of all) if (r.splitFromId && st.has(r.splitFromId)) st.get(r.splitFromId)!.split += r.weighedG;
    for (const { l, t } of lines) {
      const s = st.get(l.rollId); if (!s) continue;
      if (t.type === "TRANSFER") s.loc = t.destLocationId; else s.consumed += l.kgG + l.wasteG;
    }
    for (const a of adj) { const s = st.get(a.rollId); if (s) s.adjusted += a.kgChangeG; }
    const diffs: string[] = [];
    for (const r of all) {
      const s = st.get(r.id)!;
      const rem = r.weighedG - s.consumed + s.adjusted - s.split;
      const want = { currentLocationId: s.loc, consumedG: s.consumed, adjustedG: s.adjusted, splitG: s.split, remainingG: rem, status: statusFor(r, rem) };
      const bad = (Object.keys(want) as (keyof typeof want)[]).filter((k) => want[k] !== r[k]);
      if (bad.length) { diffs.push(`${r.serial}: ${bad.join(", ")}`); await tx.update(rolls).set(want).where(eq(rolls.id, r.id)); }
    }
    await writeAudit(tx, u, "REBUILD", "rolls", null, { details: { corrected: diffs.length, diffs: diffs.slice(0, 200) } });
    return diffs;
  });
}

// ---------------------------------------------------------------- find

export async function findAnything(qRaw: string) {
  const pc = parseCode(qRaw);
  const q = pc.kind === "roll" ? pc.serial : qRaw.trim().toUpperCase();
  if (!q) return { kind: "none" as const, q };
  const [roll] = await db.select({ s: rolls.serial }).from(rolls).where(eq(rolls.serial, q));
  if (roll) return { kind: "roll" as const, serial: roll.s };
  if (q.startsWith("RK-")) { const [rk] = await db.select().from(racks).where(eq(racks.code, q.slice(3))); if (rk) return { kind: "rack" as const, code: rk.code }; }
  const [to] = await db.select().from(transferOrders).where(eq(transferOrders.toNumber, q));
  if (to) return { kind: "to" as const, id: to.id };
  if (/^\d+$/.test(q)) {
    const cands = await db.select().from(transferOrders).where(sql`regexp_replace(${transferOrders.toNumber}, '^TRO[CR]-0*', '') = ${String(Number(q))}`);
    if (cands.length === 1) return { kind: "to" as const, id: cands[0].id };
  }
  const orders = await db.select({ o: orderLinks, t: transferOrders }).from(orderLinks).innerJoin(transferOrders, eq(transferOrders.id, orderLinks.toId))
    .where(sql`upper(${orderLinks.orderNumber}) = ${q}`).orderBy(asc(orderLinks.pieceIndex));
  if (orders.length) return { kind: "order" as const, order: q, pieces: orders };
  const fab = resolveFabric(await db.select().from(fabricItems), q);
  if (fab) return { kind: "fabric" as const, id: fab.id };
  return { kind: "none" as const, q };
}

export async function fabricReport(fabricId: string) {
  const [f] = await db.select().from(fabricItems).where(eq(fabricItems.id, fabricId));
  if (!f) return null;
  const stock = (await db.execute(sql`
    select l.name as location,
      coalesce(sum(r.remaining_g) filter (where r.status='IN_STOCK'),0)::int as kg,
      count(*) filter (where r.status='IN_STOCK')::int as rolls,
      coalesce(sum(r.remaining_g) filter (where r.status='AWAITING_LABEL'),0)::int as waiting
    from rolls r join locations l on l.id = r.current_location_id
    where r.fabric_item_id = ${fabricId} and r.status <> 'FINISHED' group by l.name order by kg desc`)).rows as { location: string; kg: number; rolls: number; waiting: number }[];
  const moves = await db.select({ l: toLines, t: transferOrders, r: rolls }).from(toLines).innerJoin(transferOrders, eq(transferOrders.id, toLines.toId))
    .innerJoin(rolls, eq(rolls.id, toLines.rollId)).where(eq(rolls.fabricItemId, fabricId)).orderBy(desc(transferOrders.postedAt)).limit(25);
  return { f, stock, moves };
}

// ---------------------------------------------------------------- Zoho prompt (for Claude + the Zoho connector)

const ZOHO_PROMPT_INTRO = [
  "Create the transfer orders below in Zoho Inventory with the Zoho MCP. They come from our Rajdanga Fabric app, which is the source of truth.",
  "",
  "How to do it",
  '1. Use organization_id "" (the default organisation) on every Zoho call.',
  "2. First check Zoho for each Transfer Order# below (list_transfer_orders). If one already exists, skip it and tell me. Never create a number twice.",
  "3. Find each item by SKU first; if not found, by the Zoho item ID, then by the exact item name. If you still cannot find it, stop and ask me. Do not create or edit items.",
  "4. Find each location by its Zoho location ID when given, otherwise by its name.",
  "5. Before creating anything, show me a short list of what you will create (number, date, from → to, items, kg) and wait for my OK.",
  "6. After my OK, create one transfer order per block with create_transfer_order: the Transfer Order# exactly as written, the date, from and to location, every line item with its quantity in kg, and the notes in the description.",
  "7. The fabric has already moved or been used, so mark each created order as received (mark_transfer_order_as_received).",
  "8. Finish with a table: Transfer Order# | Zoho transfer order ID | Status | Lines | Total kg. Change nothing else in Zoho.",
  "",
  "Consumption orders (TROC) move fabric to a production location: it is cut into cloth there and is no longer fabric stock.",
];

export async function zohoPrompt(input: string) {
  let nums = String(input || "").toUpperCase().split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const all = await db.select().from(transferOrders).where(eq(transferOrders.status, "POSTED")).orderBy(asc(transferOrders.postedAt));
  if (nums.length === 1 && nums[0] === "ALL") nums = all.filter((t) => !t.enteredInZoho).map((t) => t.toNumber);
  nums = [...new Set(nums)];
  const fabs = new Map((await db.select().from(fabricItems)).map((f) => [f.fabricNo ?? f.id, f]));
  const locs = new Map((await db.select().from(locations)).map((l) => [l.id, l]));
  const where = (id: string) => { const l = locs.get(id); return `${l?.name}${l?.zohoLocationId ? ` (Zoho location ID ${l.zohoLocationId})` : ""}`; };
  const blocks: string[] = [], missing: string[] = [], already: string[] = [];
  for (const no of nums) {
    const t = all.find((x) => x.toNumber === no || (/^\d+$/.test(no) && x.toNumber.replace(/^TRO[CR]-0*/, "") === String(Number(no))));
    if (!t) { missing.push(no); continue; }
    if (t.enteredInZoho) already.push(t.toNumber);
    const lines = await db.select().from(toLines).where(eq(toLines.toId, t.id));
    const orig = t.reversalOfId ? all.find((x) => x.id === t.reversalOfId) : undefined;
    const items = new Map<string, { kg: number; used: number; waste: number; rolls: number; batches: Set<string> }>();
    for (const l of lines) {
      const it = items.get(l.fabricNo) ?? { kg: 0, used: 0, waste: 0, rolls: 0, batches: new Set<string>() };
      const kg = Math.abs(l.kgG), w = Math.abs(l.wasteG);
      it.used += kg; it.waste += w; it.kg += kg + w; it.rolls++; if (l.batchCode) it.batches.add(l.batchCode);
      items.set(l.fabricNo, it);
    }
    const cons = t.type === "CONSUMPTION";
    const notes = [t.reason ? `Reason: ${t.reason}` : "", t.stylePO ? `Style PO: ${t.stylePO}` : "", t.moNumber ? `MO: ${t.moNumber}` : "", t.taxInvoiceNo ? `Tax invoice: ${t.taxInvoiceNo}` : ""].filter(Boolean);
    const b = [`--- ${t.toNumber} ---`,
      `Type: ${cons ? `Consumption (fabric used for ${t.stylePO || "a style order"})` : "Transfer (rolls moved)"}${orig ? ` · REVERSAL of ${orig.toNumber} (moves the fabric back)` : ""}`,
      `Transfer Order#: ${t.toNumber}`, `Date: ${t.date}`, `From: ${where(t.sourceLocationId)}`, `To: ${where(t.destLocationId)}`,
      `Notes: ${notes.length ? notes.join("; ") : "—"}; posted in the app by ${t.postedBy}`, "Line items:"];
    let tot = 0, i = 0;
    for (const [fno, it] of items) {
      const f = fabs.get(fno); tot += it.kg; i++;
      b.push(`${i}. SKU ${f?.sku || "(none)"} · Zoho item "${f?.itemName || fno}"${f?.zohoItemId ? ` (ID ${f.zohoItemId})` : ""} · Rajdanga Fabric # ${fno} · ${fmtKg(it.kg)} kg`
        + `${cons && it.waste ? ` (${fmtKg(it.used)} used + ${fmtKg(it.waste)} waste)` : ""} · ${it.rolls} roll${it.rolls === 1 ? "" : "s"}${it.batches.size ? ` · batch ${[...it.batches].join(", ")}` : ""}`);
    }
    b.push(`Total: ${fmtKg(tot)} kg`);
    if (t.enteredInZoho) b.push("Note: the app already says this one is entered in Zoho. Check Zoho first and skip it if it is there.");
    blocks.push(b.join("\n"));
  }
  const text = blocks.length ? `${ZOHO_PROMPT_INTRO.join("\n")}\n\nTransfer orders (${blocks.length})\n\n${blocks.join("\n\n")}` : "";
  return { text, found: blocks.length, missing, already };
}
