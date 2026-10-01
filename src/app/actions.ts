"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { run, UserError } from "@/lib/errors";
import { actionUser } from "@/lib/session";
import * as P from "@/lib/posting";
import * as W from "@/lib/warehouse";
import * as C from "@/lib/check";
import * as D from "@/lib/demo";
import { toG } from "@/lib/units";
import * as PO from "@/lib/purchasing";
import * as FL from "@/lib/floor";
import * as FB from "@/lib/fabrics";
import { serialOf } from "@/lib/codes";

const rv = (...paths: string[]) => { for (const p of paths) revalidatePath(p); revalidatePath("/", "layout"); };

// ---------------- receive, labels
export async function receivePOAction(input: P.ReceiveInput) {
  return run(async () => {
    const u = await actionUser(["ADMIN", "INVENTORY"]);
    const r = await P.receivePO(u, input);
    if (r.ok) rv("/rolls", "/labels", "/warehouse");
    return r;
  });
}
export async function markLabelsPrintedAction(rollIds: string[]) {
  return run(async () => { const u = await actionUser(["ADMIN"]); const n = await P.markLabelsPrinted(u, rollIds); rv("/labels"); return n; });
}
export async function lookupActivateAction(serial: string) {
  return run(async () => { await actionUser(["ADMIN", "INVENTORY"]); return P.lookupForActivate(serial); });
}
export async function activateLabelsAction(serials: string[]) {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY"]); const n = await P.activateLabels(u, serials); rv("/labels", "/rolls"); return n; });
}

// ---------------- TROR / TROC
export async function previewTOAction(input: P.TOInput) {
  return run(async () => {
    const u = await actionUser(input.type === "CONSUMPTION" ? ["ADMIN", "MERCHANDISER"] : ["ADMIN", "INVENTORY", "MERCHANDISER"]);
    return P.previewTO(u, input);
  });
}
export async function postTOAction(input: P.TOInput) {
  return run(async () => {
    const u = await actionUser(input.type === "CONSUMPTION" ? ["ADMIN", "MERCHANDISER"] : ["ADMIN", "INVENTORY"]);
    const r = await P.postTO(u, input);
    if (r.ok) rv("/log", "/orders", "/warehouse", "/labels");
    return r;
  });
}
export async function reverseTOAction(toNumber: string, reason: string) {
  return run(async () => {
    const u = await actionUser(["ADMIN", "INVENTORY", "MERCHANDISER"]);
    const r = await P.reverseTO(u, toNumber, reason);
    rv("/log", "/orders", "/warehouse");
    return r;
  });
}
export async function setZohoAction(toId: string, value: boolean) {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY", "MERCHANDISER"]); await P.setEnteredInZoho(u, toId, value); rv("/log"); });
}
export async function rollInfoAction(code: string) {
  return run(async () => {
    await actionUser();
    const serial = serialOf(code);
    const [r] = await db.select({ serial: schema.rolls.serial, fabricNo: schema.fabricItems.fabricNo, sku: schema.fabricItems.sku, item: schema.fabricItems.itemName, colour: schema.fabricItems.colour,
      remainingG: schema.rolls.remainingG, status: schema.rolls.status, loc: schema.rolls.currentLocationId, invoice: schema.rolls.invoiceNo, batch: schema.batches.code,
      takenOutAt: schema.rolls.takenOutAt, takenOutFor: schema.rolls.takenOutFor, takenOutPurpose: schema.rolls.takenOutPurpose })
      .from(schema.rolls).innerJoin(schema.fabricItems, eq(schema.fabricItems.id, schema.rolls.fabricItemId)).innerJoin(schema.batches, eq(schema.batches.id, schema.rolls.batchId))
      .where(eq(schema.rolls.serial, serial));
    if (!r) throw new UserError(`${serial}: no roll with this serial.`);
    return { ...r, takenOutAt: r.takenOutAt?.toISOString() ?? null };
  });
}
export async function zohoPromptAction(input: string) {
  return run(async () => { await actionUser(); return P.zohoPrompt(input); });
}

// ---------------- drafts (scans survive closing the page)
async function clearDraft(userId: string, kind: string) {
  await db.delete(schema.drafts).where(and(eq(schema.drafts.userId, userId), eq(schema.drafts.kind, kind)));
}
export async function saveDraftAction(kind: "TRANSFER" | "CONSUMPTION" | "RECEIVE", data: unknown) {
  return run(async () => {
    const u = await actionUser();
    if (JSON.stringify(data).length > 200_000) throw new UserError("Draft too large.");
    await db.insert(schema.drafts).values({ userId: u.id, kind, data: data as never })
      .onConflictDoUpdate({ target: [schema.drafts.userId, schema.drafts.kind], set: { data: data as never, updatedAt: new Date() } });
  });
}
export async function discardDraftAction(kind: "TRANSFER" | "CONSUMPTION" | "RECEIVE") {
  return run(async () => { const u = await actionUser(); await clearDraft(u.id, kind); });
}

// ---------------- adjustments
export async function requestAdjustmentAction(input: { serial: string; kgChange: string; reason: P.AdjReason; note?: string; photoUrl?: string }) {
  return run(async () => {
    const u = await actionUser(["ADMIN", "INVENTORY"]);
    const kgChangeG = toG(input.kgChange);
    if (Number.isNaN(kgChangeG)) throw new UserError("Kg change must be a number, e.g. -1.25 or 0.5");
    const r = await P.requestAdjustment(u, { ...input, kgChangeG });
    rv("/adjustments");
    return r;
  });
}
export async function decideAdjustmentAction(id: string, approve: boolean, note: string) {
  return run(async () => {
    const u = await actionUser(["ADMIN"]);
    await P.decideAdjustment(u, id, approve, note);
    rv("/adjustments");
  });
}
export async function reverseAdjustmentAction(id: string, reason: string) {
  return run(async () => {
    const u = await actionUser(["ADMIN"]);
    const r = await P.reverseAdjustment(u, id, reason);
    rv("/adjustments");
    return r;
  });
}

// ---------------- warehouse
export async function putAwayAction(input: { rackCode: string | null; serial: string; confirm?: "move" | "putBack" }) {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY"]); const r = await W.putAwayScan(u, input); rv("/warehouse"); return r; });
}
export async function moveAction(input: { from: string; to: string; serial: string }) {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY"]); const r = await W.moveScan(u, input); rv("/warehouse"); return r; });
}
export async function checkRackAction(code: string) {
  return run(async () => {
    await actionUser();
    const c = code.trim().toUpperCase().replace(/^RK-/, "");
    const [r] = await db.select().from(schema.racks).where(eq(schema.racks.code, c));
    if (!r || !r.active) throw new UserError(`Unknown rack label RK-${c}`);
    return { code: r.code, id: r.id };
  });
}
export async function startCountAction(code: string) {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY"]); return W.startCount(u, code); });
}
export async function countScanAction(countId: string, serial: string) {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY"]); const r = await W.countScan(u, countId, serial); rv("/warehouse/count"); return r; });
}
export async function countFixAction(countId: string, serial: string) {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY"]); await W.countFixHere(u, countId, serial); rv("/warehouse"); });
}
export async function finishCountAction(countId: string, note: string) {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY"]); const r = await W.finishCount(u, countId, note); rv("/warehouse"); return r; });
}
export async function cancelCountAction(countId: string) {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY"]); await W.cancelCount(u, countId); rv("/warehouse/count"); });
}

// ---------------- Carbonwork check
export async function createCheckAction(input: { stockName: string; stockCsv: string; ledgerName?: string; ledgerCsv?: string }) {
  return run(async () => {
    const u = await actionUser(["ADMIN", "INVENTORY"]);
    if (input.stockCsv.length > 5_000_000 || (input.ledgerCsv?.length ?? 0) > 20_000_000) throw new UserError("File too large.");
    const id = await C.createCheck(u, input);
    rv("/check");
    return id;
  });
}
export async function recordWeighAction(checkId: string, serial: string, kg: string) {
  return run(async () => {
    const u = await actionUser(["ADMIN", "INVENTORY"]);
    const r = await C.recordWeigh(u, checkId, serial, toG(kg));
    rv(`/check/${checkId}`);
    return r;
  });
}
export async function finishCheckAction(checkId: string, notes: string) {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY"]); await C.finishCheck(u, checkId, notes); rv("/check"); });
}

// ---------------- admin tools
export async function rebuildAction() {
  return run(async () => { const u = await actionUser(["ADMIN"]); const d = await P.rebuildRolls(u); rv("/rolls"); return d; });
}
export async function loadDemoAction() {
  return run(async () => { const u = await actionUser(["ADMIN"]); const r = await D.loadDemo(u); rv("/"); return r; });
}
export async function removeDemoAction() {
  return run(async () => { const u = await actionUser(["ADMIN"]); await D.removeDemo(u); rv("/"); });
}

// ---------------- incoming POs
export async function poSummaryAction(po: string) {
  return run(async () => { await actionUser(); return PO.poSummary(po); });
}
export async function savePOAction(input: PO.POInput) {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY"]); const r = await PO.savePO(u, input); rv("/pos"); return r; });
}
export async function importPOsAction(text: string, source: string) {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY"]); const r = await PO.importPOsCsv(u, text, source || "CSV"); rv("/pos"); return r; });
}
export async function setPOStatusAction(id: string, status: "OPEN" | "CLOSED") {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY"]); await PO.setPOStatus(u, id, status); rv("/pos"); });
}

// ---------------- floor: FIFO, locator, take out
export async function fifoAction(fabric: string, locationId?: string) {
  return run(async () => { await actionUser(); return FL.fifoRolls(fabric, locationId); });
}
export async function locateAction(code: string) {
  return run(async () => { await actionUser(); const r = await FL.locateRoll(code); if (!r) throw new UserError("No roll with this serial."); return r; });
}
export async function takeOutAction(p: { code: string; purpose: string; forPO?: string; fabric?: string; confirmNotOldest?: boolean }) {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY"]); const r = await FL.takeOut(u, p); if (r.kind === "ok") rv("/warehouse", "/warehouse/takeout"); return r; });
}

// ---------------- planned TROR → pick → dispatch
export async function planTRORAction(input: P.TOInput) {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY", "MERCHANDISER"]); const r = await FL.planTROR(u, input); if (r.ok) rv("/to/pick"); return r; });
}
export async function trorViewAction(idOrNumber: string) {
  return run(async () => { await actionUser(); const v = await FL.trorView(idOrNumber); if (!v) throw new UserError(`No transfer order ${idOrNumber.toUpperCase()}.`); return v; });
}
export async function pickAction(toId: string, code: string, opt: { cutKg?: string; whole?: boolean } = {}) {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY"]); return FL.pickForTROR(u, toId, code, opt); });
}
export async function unpickAction(toId: string, code: string) {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY"]); await FL.unpickForTROR(u, toId, code); });
}
export async function dispatchAction(toId: string, opt: { shortReason?: string } = {}) {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY"]); const r = await FL.dispatchTROR(u, toId, opt); if (r.ok) rv("/log", "/warehouse", "/to/pick", "/labels"); return r; });
}
export async function cancelTRORAction(toId: string, reason: string) {
  return run(async () => { const u = await actionUser(["ADMIN", "INVENTORY", "MERCHANDISER"]); await FL.cancelTROR(u, toId, reason); rv("/to/pick"); });
}

// ---------------- fabric repository
export async function suggestFabricAction(groupId: string, colour: string) {
  return run(async () => { await actionUser(["ADMIN"]); return FB.suggestFor(groupId, colour); });
}
export async function saveGroupAction(p: FB.GroupInput) {
  return run(async () => { const u = await actionUser(["ADMIN"]); const g = await FB.saveGroup(u, p); rv("/admin/fabric-groups"); return { id: g.id }; });
}
export async function addColourAction(p: FB.ColourInput) {
  return run(async () => { const u = await actionUser(["ADMIN"]); const it = await FB.addColour(u, p); rv("/admin/fabric-groups", "/admin/fabrics"); return { fabricNo: it.fabricNo, sku: it.sku }; });
}
export async function buildGroupsAction() {
  return run(async () => { const u = await actionUser(["ADMIN"]); const r = await FB.buildGroupsFromItems(u); rv("/admin/fabric-groups"); return r; });
}
