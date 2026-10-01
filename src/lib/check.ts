import "server-only";
import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { UserError } from "./errors";
import { parseCsv, pick } from "./csv";
import { toG, todayIST } from "./units";
import { getSettings } from "./settings";
import { writeAudit } from "./tx";
import type { CurrentUser } from "./perm";

const { rolls, fabricItems, locations, checks, spotWeighs, transferOrders } = schema;

export type CheckRow = {
  key: string;
  fabricItemId: string | null;
  fabricNo: string | null;
  fabricCode: string;
  colour: string;
  locationId: string | null;
  location: string;
  sheetG: number;
  cwG: number;
  diffG: number; // sheet − carbonwork
  flag: "OK" | "CHECK" | "ONLY_CW" | "ONLY_SHEET";
  note?: string;
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Reads a Carbonwork fabric_stock CSV and compares it row by row with the app. Gaps are flagged, never corrected. */
export async function createCheck(
  u: CurrentUser,
  input: { stockName: string; stockCsv: string; ledgerName?: string; ledgerCsv?: string },
) {
  if (!["ADMIN", "INVENTORY"].includes(u.role)) throw new UserError("Only Admin or Inventory run spot checks.");
  const rows = parseCsv(input.stockCsv);
  if (!rows.length) throw new UserError("The file has no rows.");
  const headers = Object.keys(rows[0]);
  const H = {
    code: pick(headers, ["fabric", "fabric_code", "fabric code", "code"]),
    colour: pick(headers, ["colour", "color"]),
    loc: pick(headers, ["location", "location_name"]),
    kg: pick(headers, ["here_kg", "kg_here", "kg here", "in_house_kg", "on_hand_kg", "kg"]),
    date: pick(headers, ["snapshot_date", "date"]),
  };
  const missing = (["code", "colour", "loc", "kg"] as const).filter((k) => !H[k]).map((k) => ({ code: "fabric", colour: "colour", loc: "location", kg: "here_kg" })[k]);
  if (missing.length) throw new UserError(`This isn't a fabric_stock CSV (missing column ${missing.map((m) => `"${m}"`).join(", ")}). Found: ${headers.join(", ")}`);
  const fileDate = (input.stockName.match(/\d{4}-\d{2}-\d{2}/)?.[0]) || (H.date ? String(rows[0][H.date] ?? "").slice(0, 10) : "") || todayIST();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fileDate)) throw new UserError("Couldn't read the file date. Use a file named fabric_stock_YYYY-MM-DD.csv.");

  const settings = await getSettings();
  const tolG = Math.round(Number(settings.checkTolKg) * 1000);
  const tolPct = Number(settings.checkTolPct);
  const locs = await db.select().from(locations);
  const cwName = new Map(locs.map((l) => [l.id, l.carbonworkName || l.name]));
  const key = (f: string, c: string, l: string) => [f, c, l].map((x) => norm(x).toUpperCase()).join("|");

  // App side: kg In stock + Awaiting label, by Carbonwork fabric code + colour + Carbonwork location name
  const mine = await db.select({ r: rolls, f: fabricItems }).from(rolls).innerJoin(fabricItems, eq(fabricItems.id, rolls.fabricItemId))
    .where(inArray(rolls.status, ["IN_STOCK", "AWAITING_LABEL"]));
  const sheet = new Map<string, number>(); const label = new Map<string, { code: string; colour: string; loc: string; fabricNo: string | null }>();
  for (const { r, f } of mine) {
    const l = cwName.get(r.currentLocationId) ?? "";
    const k = key(f.cwFabricCode ?? "", f.colour ?? "", l);
    sheet.set(k, (sheet.get(k) ?? 0) + r.remainingG);
    if (!label.has(k)) label.set(k, { code: f.cwFabricCode ?? "", colour: f.colour ?? "", loc: l, fabricNo: f.fabricNo });
  }
  const cw = new Map<string, number>();
  for (const r of rows) {
    const code = String(r[H.code!] ?? "").trim(), colour = String(r[H.colour!] ?? "").trim(), loc = String(r[H.loc!] ?? "").trim();
    const g = toG(r[H.kg!] || 0);
    if (!loc || Number.isNaN(g)) continue;
    const k = key(code, colour, loc);
    cw.set(k, (cw.get(k) ?? 0) + g);
    if (!label.has(k)) label.set(k, { code, colour, loc, fabricNo: null });
  }
  const locByCw = new Map(locs.map((l) => [norm(l.carbonworkName || l.name).toUpperCase(), l]));
  const results: CheckRow[] = [...label.entries()].map(([k, lb]) => {
    const s = sheet.get(k) ?? 0, c = cw.get(k) ?? 0, gap = s - c;
    let flag: CheckRow["flag"] = "OK";
    if (!sheet.has(k) && Math.abs(c) > tolG) flag = "ONLY_CW";
    else if (!cw.has(k) && Math.abs(s) > tolG) flag = "ONLY_SHEET";
    else if (Math.abs(gap) > tolG && Math.abs(gap) > (Math.abs(c) * tolPct) / 100) flag = "CHECK";
    const l = locByCw.get(norm(lb.loc).toUpperCase());
    return { key: k, fabricItemId: null, fabricNo: lb.fabricNo, fabricCode: lb.code, colour: lb.colour, locationId: l?.id ?? null, location: lb.loc,
      sheetG: s, cwG: c, diffG: gap, flag, note: !l ? "Location not in Locations — set its Carbonwork Name" : undefined };
  }).filter((r) => !(r.sheetG === 0 && r.cwG === 0)).sort((a, b) => Math.abs(b.diffG) - Math.abs(a.diffG));

  // Optional: TRO numbers in the ledger file against the TO Log
  let toMatch: { onlyInCarbonwork: string[]; onlyInSheet: string[] } | null = null;
  if (input.ledgerCsv) {
    const found = new Set<string>();
    for (const r of parseCsv(input.ledgerCsv)) for (const v of Object.values(r)) for (const mm of String(v).toUpperCase().matchAll(/TRO[RC]?-\d+/g)) found.add(mm[0]);
    const posted = await db.select({ no: transferOrders.toNumber }).from(transferOrders).where(lte(transferOrders.date, fileDate));
    const mineSet = new Set(posted.map((p) => p.no));
    toMatch = { onlyInCarbonwork: [...found].filter((x) => !mineSet.has(x)).sort(), onlyInSheet: [...mineSet].filter((x) => !found.has(x)).sort() };
  }

  const flagged = results.filter((r) => r.flag !== "OK");
  const [{ n: postedSince }] = await db.select({ n: sql<number>`count(*)::int` }).from(transferOrders).where(gt(transferOrders.date, fileDate));
  const [c] = await db.insert(checks).values({
    fileDate, fileName: input.stockName, ledgerName: input.ledgerName || null, createdBy: u.email,
    rowsChecked: results.length, rowsFlagged: flagged.length, kgGapG: flagged.reduce((a, r) => a + Math.abs(r.diffG), 0),
    results: { rows: results, postedSinceFile: Number(postedSince) } as never, toMatch: toMatch as never,
  }).returning();

  // Random In-stock rolls from the flagged locations (anywhere when nothing is flagged)
  const flaggedLocs = [...new Set(flagged.map((r) => r.locationId).filter(Boolean))] as string[];
  let pool = await db.select().from(rolls).where(and(eq(rolls.status, "IN_STOCK"), gt(rolls.remainingG, 0), flaggedLocs.length ? inArray(rolls.currentLocationId, flaggedLocs) : sql`true`));
  if (!pool.length) pool = await db.select().from(rolls).where(and(eq(rolls.status, "IN_STOCK"), gt(rolls.remainingG, 0)));
  const chosen = pool.sort(() => Math.random() - 0.5).slice(0, Math.max(1, Number(settings.spotCheckRolls) || 5));
  if (chosen.length) await db.insert(spotWeighs).values(chosen.map((r) => ({ checkId: c.id, rollId: r.id, sheetG: r.remainingG })));
  await db.transaction((tx) => writeAudit(tx, u, "SPOT_CHECK", "check", c.id, { details: { file: input.stockName, rows: results.length, flagged: flagged.length } }));
  return c.id;
}

export async function recordWeigh(u: CurrentUser, checkId: string, serial: string, weighedG: number) {
  if (!["ADMIN", "INVENTORY"].includes(u.role)) throw new UserError("Only Admin or Inventory weigh spot-check rolls.");
  if (!Number.isInteger(weighedG) || weighedG < 0) throw new UserError("Enter the weighed kg.");
  const [r] = await db.select().from(rolls).where(eq(rolls.serial, serial.trim().toUpperCase()));
  if (!r) throw new UserError("No such roll.");
  const [sw] = await db.select().from(spotWeighs).where(and(eq(spotWeighs.checkId, checkId), eq(spotWeighs.rollId, r.id)));
  if (!sw) throw new UserError(`${r.serial} isn't one of the rolls picked for this check.`);
  await db.update(spotWeighs).set({ weighedG, weighedAt: new Date(), weighedBy: u.email }).where(eq(spotWeighs.id, sw.id));
  return { diffG: weighedG - sw.sheetG };
}

export async function finishCheck(u: CurrentUser, checkId: string, notes: string) {
  if (!["ADMIN", "INVENTORY"].includes(u.role)) throw new UserError("Not allowed.");
  const ws = await db.select().from(spotWeighs).where(eq(spotWeighs.checkId, checkId));
  await db.update(checks).set({
    status: "DONE", finishedAt: new Date(), notes: notes.trim() || null, rollsWeighed: ws.filter((w) => w.weighedG !== null).length,
  }).where(eq(checks.id, checkId));
  await db.transaction((tx) => writeAudit(tx, u, "CHECK_FINISHED", "check", checkId, { details: { notes } }));
}
