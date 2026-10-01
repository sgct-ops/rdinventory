import "server-only";
import { asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { UserError } from "./errors";
import { FMT } from "./formats";
import { writeAudit } from "./tx";
import { getSettings } from "./settings";
import type { CurrentUser } from "./perm";

/**
 * Fabric repository: Fabric group × colour = one fabric item.
 *
 * Numbering (you can always type your own instead):
 *  - Single Jersey (and other) groups take the next free number: 55, 56, 57 …
 *  - A Rib group is paired with its Single Jersey group ("Fabric 8D2 Rib" ↔ "Fabric 8D2"). The same colour in the Rib
 *    group takes the Single Jersey number + B: 55 → 55B. If the Rib colour comes first, the Single Jersey colour later
 *    takes the plain number (55B → 55).
 * SKU suggestion: <prefix><group code>-<first 3 letters of the colour>, e.g. 8D2-PIN, 8D2R-PIN.
 */
const { fabricGroups, fabricItems } = schema;
type Group = typeof fabricGroups.$inferSelect;
type Item = typeof fabricItems.$inferSelect;

export const isRibName = (name: string) => /\brib\b/i.test(name);
const baseName = (name: string) => name.replace(/\brib\b/gi, "").replace(/\s+/g, " ").trim().toUpperCase();
export function groupCodeFrom(name: string) {
  const rib = isRibName(name);
  const core = name.replace(/\bfabric\b/gi, "").replace(/\brib\b/gi, "").replace(/[^A-Za-z0-9]+/g, " ").trim().toUpperCase().split(" ").filter(Boolean).join("");
  return (core.slice(0, 8) || "FAB") + (rib ? "R" : "");
}
const numOf = (fno: string | null) => { const m = String(fno ?? "").match(/^(\d+)/); return m ? Number(m[1]) : null; };
const sameColour = (a: string | null, b: string | null) => (a ?? "").trim().toUpperCase() === (b ?? "").trim().toUpperCase();

async function context() {
  const [groups, items] = await Promise.all([db.select().from(fabricGroups), db.select().from(fabricItems)]);
  return { groups, items };
}
function nextFree(items: Item[]) {
  return Math.max(0, ...items.map((i) => numOf(i.fabricNo) ?? 0)) + 1;
}
const taken = (items: Item[], fno: string) => items.some((i) => (i.fabricNo ?? "").toUpperCase() === fno.toUpperCase());

/** The number and SKU the repository would give a new colour in this group (nothing is written). */
export async function suggestFor(groupId: string, colourRaw: string) {
  const colour = colourRaw.trim();
  const { groups, items } = await context();
  const g = groups.find((x) => x.id === groupId);
  if (!g) throw new UserError("Pick a fabric group.");
  const exists = colour && items.find((i) => i.groupId === g.id && sameColour(i.colour, colour));
  const pair = g.pairGroupId ? groups.find((x) => x.id === g.pairGroupId) : undefined;
  const twin = colour && pair ? items.find((i) => i.groupId === pair.id && sameColour(i.colour, colour)) : undefined;
  let fabricNo: string;
  let why: string;
  if (g.kind === "RIB") {
    if (twin && numOf(twin.fabricNo) !== null) {
      const n = numOf(twin.fabricNo)!;
      fabricNo = [..."BCDEFGHJK"].map((l) => `${n}${l}`).find((c) => !taken(items, c)) ?? `${nextFree(items)}B`;
      why = `Rib of ${pair!.name} · ${colour} (${twin.fabricNo}) → same number + B`;
    } else { fabricNo = `${nextFree(items)}B`; why = pair ? `No ${colour || "matching"} colour in ${pair.name} yet → next number + B` : "Rib group without a Single Jersey pair → next number + B"; }
  } else {
    const n = twin ? numOf(twin.fabricNo) : null;
    if (n !== null && !taken(items, String(n))) { fabricNo = String(n); why = `${pair!.name} · ${colour} is ${twin!.fabricNo} → plain number`; }
    else { fabricNo = String(nextFree(items)); why = "Next free number"; }
  }
  const s = await getSettings();
  const col = colour.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "COL";
  let sku = `${s.skuPrefix}${g.code}-${col}`;
  for (let i = 2; items.some((x) => (x.sku ?? "").toUpperCase() === sku.toUpperCase()) && i < 99; i++) sku = `${s.skuPrefix}${g.code}-${col}${i}`;
  return { fabricNo, sku, why, exists: exists ? { fabricNo: exists.fabricNo, sku: exists.sku } : null, itemName: `${g.name}-${colour}`, group: g.name };
}

export type GroupInput = { id?: string; name: string; code?: string; kind?: string; pairGroupId?: string | null; cwFabricCode?: string; vendor?: string };

export async function saveGroup(u: CurrentUser, p: GroupInput) {
  if (u.role !== "ADMIN") throw new UserError("Only the admin edits the fabric repository.");
  const name = p.name.replace(/\s+/g, " ").trim();
  if (!name) throw new UserError("Give the group a name, e.g. Fabric 8D2 or Fabric 8D2 Rib.");
  const kind = ["SJ", "RIB", "OTHER"].includes(String(p.kind)) ? String(p.kind) : isRibName(name) ? "RIB" : "SJ";
  const code = (p.code?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || groupCodeFrom(name)).slice(0, 10);
  return db.transaction(async (tx) => {
    const all = await tx.select().from(fabricGroups);
    if (all.some((g) => g.name.toUpperCase() === name.toUpperCase() && g.id !== p.id)) throw new UserError(`There is already a group called ${name}.`);
    // pair a Rib group with its Single Jersey group (and back) by name, unless one is chosen
    let pairId = p.pairGroupId === undefined ? undefined : p.pairGroupId || null;
    if (pairId === undefined) {
      const twin = all.find((g) => g.id !== p.id && baseName(g.name) === baseName(name) && (kind === "RIB" ? g.kind !== "RIB" : g.kind === "RIB"));
      pairId = twin?.id ?? null;
    }
    const vals = { name, code, kind, pairGroupId: pairId, cwFabricCode: p.cwFabricCode?.trim() || null, vendor: p.vendor?.trim() || null };
    const [g] = p.id ? await tx.update(fabricGroups).set(vals).where(eq(fabricGroups.id, p.id)).returning() : await tx.insert(fabricGroups).values(vals).returning();
    if (pairId) await tx.update(fabricGroups).set({ pairGroupId: g.id }).where(eq(fabricGroups.id, pairId));
    await writeAudit(tx, u, p.id ? "GROUP_UPDATED" : "GROUP_CREATED", "fabric_group", g.id, { details: vals });
    return g;
  });
}

export type ColourInput = { groupId: string; colour: string; fabricNo?: string; sku?: string; hex?: string; itemName?: string; zohoItemId?: string };

/** Add a colour to a group: one new fabric item with its Fabric # and SKU (suggested, or the ones you typed). */
export async function addColour(u: CurrentUser, p: ColourInput) {
  if (u.role !== "ADMIN") throw new UserError("Only the admin edits the fabric repository.");
  const colour = p.colour.replace(/\s+/g, " ").trim();
  if (!colour) throw new UserError("Type the colour. Colour is what makes each item in a group unique.");
  const sug = await suggestFor(p.groupId, colour);
  if (sug.exists) throw new UserError(`${sug.group} already has ${colour} (${sug.exists.fabricNo}${sug.exists.sku ? `, ${sug.exists.sku}` : ""}).`);
  const fabricNo = (p.fabricNo?.trim() || sug.fabricNo).toUpperCase();
  const sku = (p.sku?.trim() || sug.sku).toUpperCase();
  if (!FMT.fabricNo.test(fabricNo)) throw new UserError("Fabric # should be a number, optionally with letters after it (55, 55A, 55B).");
  return db.transaction(async (tx) => {
    const [g] = await tx.select().from(fabricGroups).where(eq(fabricGroups.id, p.groupId));
    const items = await tx.select().from(fabricItems);
    if (taken(items, fabricNo)) throw new UserError(`Fabric # ${fabricNo} is already used by ${items.find((i) => (i.fabricNo ?? "").toUpperCase() === fabricNo)?.itemName}.`);
    if (items.some((i) => (i.sku ?? "").toUpperCase() === sku)) throw new UserError(`SKU ${sku} is already used.`);
    if (p.zohoItemId && items.some((i) => i.zohoItemId === p.zohoItemId)) throw new UserError(`Zoho item ID ${p.zohoItemId} is already used.`);
    const [it] = await tx.insert(fabricItems).values({
      groupId: g.id, group: g.name, colour, fabricNo, sku, itemName: p.itemName?.trim() || sug.itemName, cwFabricCode: g.cwFabricCode, vendor: g.vendor,
      hex: p.hex && /^#[0-9a-f]{6}$/i.test(p.hex) ? p.hex : null, zohoItemId: p.zohoItemId?.trim() || null, unit: "kg",
    }).returning();
    await writeAudit(tx, u, "COLOUR_ADDED", "fabric", it.id, { details: { group: g.name, colour, fabricNo, sku, suggested: sug.fabricNo !== fabricNo || sug.sku !== sku ? { fabricNo: sug.fabricNo, sku: sug.sku } : undefined } });
    return it;
  });
}

/** Put existing fabric items (from the Zoho import) into groups by their group name / Carbonwork code. */
export async function buildGroupsFromItems(u: CurrentUser) {
  if (u.role !== "ADMIN") throw new UserError("Only the admin edits the fabric repository.");
  const loose = await db.select().from(fabricItems).where(isNull(fabricItems.groupId));
  let made = 0, linked = 0;
  const skipped: string[] = [];
  for (const it of loose) {
    const name = (it.group?.trim() || (it.cwFabricCode ? `Fabric ${it.cwFabricCode}` : "")).replace(/\s+/g, " ");
    if (!name) { skipped.push(`${it.fabricNo ?? it.itemName}: no group name or Carbonwork code`); continue; }
    let [g] = await db.select().from(fabricGroups).where(eq(fabricGroups.name, name));
    if (!g) { g = await saveGroup(u, { name, cwFabricCode: it.cwFabricCode ?? undefined, vendor: it.vendor ?? undefined }); made++; }
    const clash = (await db.select().from(fabricItems).where(eq(fabricItems.groupId, g.id))).find((x) => sameColour(x.colour, it.colour));
    if (clash) { skipped.push(`${it.fabricNo}: ${g.name} already has colour ${it.colour} (${clash.fabricNo})`); continue; }
    await db.update(fabricItems).set({ groupId: g.id, group: g.name }).where(eq(fabricItems.id, it.id));
    linked++;
  }
  return { made, linked, skipped };
}

export async function repository() {
  const [groups, items] = await Promise.all([
    db.select().from(fabricGroups).orderBy(asc(fabricGroups.name)),
    db.select().from(fabricItems).orderBy(asc(fabricItems.fabricNo)),
  ]);
  const names = new Map(groups.map((g) => [g.id, g.name]));
  return {
    groups: groups.map((g: Group) => ({ ...g, pairName: g.pairGroupId ? names.get(g.pairGroupId) ?? null : null,
      items: items.filter((i) => i.groupId === g.id).map((i) => ({ id: i.id, colour: i.colour, fabricNo: i.fabricNo, sku: i.sku, itemName: i.itemName, hex: i.hex, active: i.active })) })),
    loose: items.filter((i) => !i.groupId).length,
  };
}
