import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { UserError } from "./errors";
import { toG, todayIST } from "./units";
import { FMT } from "./formats";
import { writeAudit } from "./tx";
import { parseCsv } from "./csv";
import type { CurrentUser } from "./perm";

/**
 * Incoming fabric POs: what each PO is expected to bring (fabric + kg), and how much of it has come so far.
 * Lines come from Zoho / Carbonwork (CSV or the API at /api/pos) or are typed in. Receiving checks every fabric
 * against these lines; a PO can be received in several parts, each part with its own invoice.
 */
const { purchaseOrders, poLines, fabricItems, receipts } = schema;
const canEdit = (u: CurrentUser) => ["ADMIN", "INVENTORY"].includes(u.role);
const normPO = (s: string) => String(s || "").trim().toUpperCase();

export type POLineView = {
  id: string; fabricItemId: string; fabricNo: string | null; sku: string | null; item: string; colour: string | null;
  expectedG: number; expectedRolls: number | null; receivedG: number; receivedRolls: number; leftG: number; done: boolean;
};
export type POView = {
  id: string; poNumber: string; vendor: string | null; expectedDate: string | null; status: string; source: string; notes: string | null;
  lines: POLineView[]; expectedG: number; receivedG: number; receipts: { number: string; invoiceNo: string; date: string; rolls: number; kgG: number; by: string }[];
};

async function linesFor(poIds: string[]) {
  if (!poIds.length) return [];
  return (await db.execute(sql`
    select l.id, l.po_id, l.fabric_item_id, l.expected_g, l.expected_rolls, f.fabric_no, f.sku, f.item_name, f.colour, p.po_number,
      coalesce((select sum(r.weighed_g) from rolls r where r.fabric_po = p.po_number and r.fabric_item_id = l.fabric_item_id and r.split_from_id is null), 0)::int received_g,
      coalesce((select count(*) from rolls r where r.fabric_po = p.po_number and r.fabric_item_id = l.fabric_item_id and r.split_from_id is null), 0)::int received_rolls
    from po_lines l join purchase_orders p on p.id = l.po_id join fabric_items f on f.id = l.fabric_item_id
    where l.po_id in (${sql.join(poIds.map((i) => sql`${i}`), sql`, `)}) order by f.fabric_no`)).rows as Record<string, never>[];
}
const lineView = (x: Record<string, never>): POLineView => ({
  id: x.id, fabricItemId: x.fabric_item_id, fabricNo: x.fabric_no, sku: x.sku, item: x.item_name, colour: x.colour,
  expectedG: x.expected_g, expectedRolls: x.expected_rolls, receivedG: x.received_g, receivedRolls: x.received_rolls,
  leftG: Math.max(0, (x.expected_g as number) - (x.received_g as number)), done: (x.received_g as number) >= (x.expected_g as number) * 0.98,
});

/** One PO with its lines, what has arrived so far and every receipt against it. null when the PO isn't registered. */
export async function poSummary(poRaw: string): Promise<POView | null> {
  const po = normPO(poRaw);
  if (!po) return null;
  const [h] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.poNumber, po));
  if (!h) return null;
  const lines = (await linesFor([h.id])).map(lineView);
  const rc = await db.select().from(receipts).where(eq(receipts.poNumber, po)).orderBy(asc(receipts.createdAt));
  return {
    id: h.id, poNumber: h.poNumber, vendor: h.vendor, expectedDate: h.expectedDate, status: h.status, source: h.source, notes: h.notes, lines,
    expectedG: lines.reduce((a, l) => a + l.expectedG, 0), receivedG: lines.reduce((a, l) => a + l.receivedG, 0),
    receipts: rc.map((r) => ({ number: r.number, invoiceNo: r.invoiceNo, date: r.date, rolls: r.rolls, kgG: r.kgG, by: r.receivedBy })),
  };
}

export async function listPOs() {
  const heads = await db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt)).limit(2000);
  const all = await linesFor(heads.map((h) => h.id));
  const by = new Map<string, POLineView[]>();
  for (const x of all) { const k = x.po_id as string; by.set(k, [...(by.get(k) ?? []), lineView(x)]); }
  const rc = heads.length ? (await db.execute(sql`select po_number, count(*)::int n, max(date) last from receipts group by po_number`)).rows as { po_number: string; n: number; last: string }[] : [];
  const rcBy = new Map(rc.map((r) => [r.po_number, r]));
  return heads.map((h) => {
    const lines = by.get(h.id) ?? [];
    const e = lines.reduce((a, l) => a + l.expectedG, 0), r = lines.reduce((a, l) => a + l.receivedG, 0);
    return { ...h, lines, expectedG: e, receivedG: r, receiptCount: rcBy.get(h.poNumber)?.n ?? 0, lastReceipt: rcBy.get(h.poNumber)?.last ?? null };
  });
}

export type POInput = { poNumber: string; vendor?: string; expectedDate?: string; notes?: string; source?: string; lines: { item: string; kg: string | number; rolls?: string | number }[] };

async function resolveItems(items: string[]) {
  const fabs = await db.select().from(fabricItems);
  const by = (k: string) => {
    const q = k.trim().toUpperCase();
    return fabs.find((f) => (f.fabricNo ?? "").toUpperCase() === q) ?? fabs.find((f) => (f.sku ?? "").toUpperCase() === q)
      ?? fabs.find((f) => (f.zohoItemId ?? "").toUpperCase() === q) ?? fabs.find((f) => f.itemName.toUpperCase() === q) ?? null;
  };
  return items.map(by);
}

/** Create a PO or replace its lines. Lines are matched by Fabric #, SKU, Zoho item ID or item name. */
export async function savePO(u: CurrentUser, p: POInput, opts: { merge?: boolean } = {}) {
  if (!canEdit(u) && u.email !== "api") throw new UserError("Only Inventory or Admin can edit incoming POs.");
  const po = normPO(p.poNumber);
  if (!FMT.fabricPO.test(po)) throw new UserError(`PO ${po || "(empty)"} looks wrong. Use CT26/PO/48, CTF/PO/136 or PO-112.`);
  const raw = (p.lines || []).filter((l) => String(l.item || "").trim());
  if (!raw.length) throw new UserError(`${po}: add at least one fabric line.`);
  const fabs = await resolveItems(raw.map((l) => String(l.item)));
  const errs: string[] = [];
  const lines = raw.map((l, i) => {
    const f = fabs[i]; const g = toG(l.kg);
    if (!f) errs.push(`${po} line ${i + 1}: no fabric "${l.item}" in Fabric Inventory.`);
    else if (!(g > 0)) errs.push(`${po} line ${i + 1}: kg must be above 0.`);
    const rolls = l.rolls === undefined || l.rolls === "" ? null : Number(l.rolls);
    return f ? { fabricItemId: f.id, expectedG: g, expectedRolls: rolls && rolls > 0 ? Math.round(rolls) : null } : null;
  });
  if (errs.length) throw new UserError(errs.join("\n"));
  const dup = new Set<string>();
  for (const l of lines) { if (dup.has(l!.fabricItemId)) throw new UserError(`${po}: the same fabric is on two lines. Put it on one line with the total kg.`); dup.add(l!.fabricItemId); }
  return db.transaction(async (tx) => {
    const [ex] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.poNumber, po));
    const vals = { vendor: p.vendor?.trim() || ex?.vendor || null, expectedDate: p.expectedDate || ex?.expectedDate || null, notes: p.notes?.trim() || ex?.notes || null, updatedAt: new Date() };
    let id: string;
    if (ex) { await tx.update(purchaseOrders).set({ ...vals, source: p.source || ex.source }).where(eq(purchaseOrders.id, ex.id)); id = ex.id; }
    else id = (await tx.insert(purchaseOrders).values({ poNumber: po, ...vals, source: p.source || "MANUAL", createdBy: u.email }).returning())[0].id;
    if (!opts.merge) await tx.delete(poLines).where(eq(poLines.poId, id));
    for (const l of lines) await tx.insert(poLines).values({ poId: id, ...l! })
      .onConflictDoUpdate({ target: [poLines.poId, poLines.fabricItemId], set: { expectedG: l!.expectedG, expectedRolls: l!.expectedRolls } });
    await writeAudit(tx, u, ex ? "PO_UPDATED" : "PO_CREATED", "po", id, { details: { po, lines: lines.length, source: p.source || "MANUAL" } });
    return { id, po, created: !ex };
  });
}

/** CSV columns (names matched loosely): po, fabric (Fabric # / SKU / Zoho item id / name), kg, rolls, vendor, expected_date */
export async function importPOsCsv(u: CurrentUser, text: string, source = "CSV") {
  const rows = parseCsv(text);
  if (!rows.length) throw new UserError("The file is empty.");
  const key = (r: Record<string, string>, ...names: string[]) => { for (const n of names) for (const k of Object.keys(r)) if (k.toLowerCase().replace(/[^a-z]/g, "") === n) return r[k]; return ""; };
  const groups = new Map<string, POInput>();
  for (const r of rows) {
    const po = normPO(key(r, "po", "ponumber", "purchaseorder", "fabricpo", "purchaseordernumber"));
    if (!po) continue;
    const g = groups.get(po) ?? { poNumber: po, vendor: key(r, "vendor", "vendorname", "supplier"), expectedDate: key(r, "expecteddate", "deliverydate", "eta") || undefined, source, lines: [] };
    g.lines.push({ item: key(r, "fabric", "fabricno", "sku", "item", "itemname", "itemid", "zohoitemid"), kg: key(r, "kg", "qty", "quantity", "expectedkg"), rolls: key(r, "rolls", "expectedrolls") });
    groups.set(po, g);
  }
  if (!groups.size) throw new UserError("No PO numbers found. The file needs a 'po' column.");
  const done: string[] = [], failed: string[] = [];
  for (const g of groups.values()) {
    try { await savePO(u, g); done.push(g.poNumber); } catch (e) { failed.push(e instanceof Error ? e.message : String(e)); }
  }
  return { done, failed };
}

export async function setPOStatus(u: CurrentUser, id: string, status: "OPEN" | "CLOSED") {
  if (!canEdit(u)) throw new UserError("Only Inventory or Admin can change a PO.");
  await db.update(purchaseOrders).set({ status, updatedAt: new Date() }).where(eq(purchaseOrders.id, id));
  await db.transaction((tx) => writeAudit(tx, u, `PO_${status}`, "po", id, {}));
}

/** Receipt number GRN-yyMMdd-### (one per receiving). */
export const receiptPrefix = () => `GRN-${todayIST().replaceAll("-", "").slice(2)}-`;
