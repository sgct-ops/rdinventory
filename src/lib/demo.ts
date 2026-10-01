import "server-only";
import { and, eq, inArray, like, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { UserError } from "./errors";
import { todayIST } from "./units";
import type { CurrentUser } from "./perm";
import { receivePO, postTO, reverseTO, requestAdjustment, activateLabels, type TOInput } from "./posting";
import { putAwayScan } from "./warehouse";
import { createCheck, recordWeigh, finishCheck } from "./check";
import { writeAudit } from "./tx";
import { savePO } from "./purchasing";
import { saveGroup } from "./fabrics";
import { takeOut, planTROR } from "./floor";

/** Everything demo is marked so "Remove demo data" can take it out again (same markers as the Google Sheet). */
export const DEMO_FAB_NOS = ["990A", "990B", "991A", "991B", "992"];
const DEMO_FABRICS = [ // Fabric #, Carbonwork fabric, colour, Zoho item, SKU, vendor, hex
  ["990A", "8D2", "Pine Green", "Fabric 8D2-Pine Green", "DM-SKU-8D2-PIN", "RSWM (DEMO)", "#2f5d46"],
  ["990B", "8D2", "Midnight Plum", "Fabric 8D2-Midnight Plum", "DM-SKU-8D2-MID", "RSWM (DEMO)", "#4a2d4f"],
  ["991A", "3D2", "Chalk", "Fabric 3D2-Chalk", "DM-SKU-3D2-CHA", "Sutlej (DEMO)", "#efece2"],
  ["991B", "3D2", "Carbon Black", "Fabric 3D2-Carbon Black", "DM-SKU-3D2-CAR", "Sutlej (DEMO)", "#1d1d1f"],
  ["992", "12", "Black", "Fabric 12-Black", "DM-SKU-12-BLA", "Nahar (DEMO)", "#111111"],
];
export const STARTER_LOCATIONS: [string, string, "STORAGE" | "PRODUCTION" | "FACTORY"][] = [
  ["RJS", "Rajdanga Storage", "STORAGE"], ["RJP", "Rajdanga Production", "PRODUCTION"], ["EXIM", "Exim", "FACTORY"],
  ["AMRIT", "Amrit Impex", "FACTORY"], ["LUV", "LUVKART", "FACTORY"], ["SIDDHI", "Siddhivinayak", "FACTORY"], ["ANSH", "Anshuree", "FACTORY"],
];
export const STARTER_RACKS: [string, string, string][] = [
  ["R1-A", "Room 1", "Storage Building"], ["R1-B", "Room 1", "Storage Building"], ["R2-A", "Room 2", "Factory Building"], ["R2-B", "Room 2", "Factory Building"],
  ["R3-A", "Room 3", "Factory Building"], ["R3-B", "Room 3", "Factory Building"], ["R4-A", "Room 4", "Factory Building"], ["R4-B", "Room 4", "Factory Building"],
];
const DEMO_LOC_INFO: Record<string, [string, string, string]> = {
  "Rajdanga Storage": ["(DEMO) Plot 14, Rajdanga Main Rd, Kolkata 700107", "DEMO-46000001", "(DEMO) Store in-charge · 98300 00001"],
  "Rajdanga Production": ["(DEMO) Plot 14, Rajdanga Main Rd, Kolkata 700107 (1st floor)", "DEMO-46000002", "(DEMO) Floor supervisor · 98300 00002"],
  Exim: ["(DEMO) Tiljala Industrial Estate, Kolkata 700039", "DEMO-46000003", "(DEMO) Exim office · 98300 00003"],
  "Amrit Impex": ["(DEMO) Howrah Foundry Rd, Howrah 711101", "DEMO-46000004", "(DEMO) Amrit dispatch · 98300 00004"],
  LUVKART: ["(DEMO) Topsia Rd South, Kolkata 700046", "DEMO-46000005", "(DEMO) LUVKART stores · 98300 00005"],
  Siddhivinayak: ["(DEMO) Liluah Industrial Area, Howrah 711204", "DEMO-46000006", "(DEMO) Siddhivinayak · 98300 00006"],
  Anshuree: ["(DEMO) Kasba Industrial Estate, Kolkata 700107", "DEMO-46000007", "(DEMO) Anshuree · 98300 00007"],
};

export const RAJDANGA_EMAIL = "rajdanga@carbontree.com";
/** Starter locations + racks + the Rajdanga login (safe to run again). */
export async function ensureStarter() {
  for (const [code, name, type] of STARTER_LOCATIONS)
    await db.insert(schema.locations).values({ code, name, type, carbonworkName: name }).onConflictDoNothing();
  const [store] = await db.select().from(schema.locations).where(eq(schema.locations.name, "Rajdanga Storage"));
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from racks`)).rows as { n: number }[];
  if (store && !n) for (const [i, [code, room, building]] of STARTER_RACKS.entries())
    await db.insert(schema.racks).values({ code, room, building, locationId: store.id, capacity: 48, sortOrder: i }).onConflictDoNothing();
  // The Rajdanga warehouse login receives only at Rajdanga Storage (change it in Users & access)
  if (store) {
    const [prod] = await db.select().from(schema.locations).where(eq(schema.locations.name, "Rajdanga Production"));
    const [ru] = await db.insert(schema.users).values({ email: RAJDANGA_EMAIL, name: "Rajdanga warehouse", role: "INVENTORY", receiveLocationId: store.id }).onConflictDoNothing().returning();
    if (ru) await db.insert(schema.userLocations).values([store, prod].filter(Boolean).map((l) => ({ userId: ru.id, locationId: l!.id }))).onConflictDoNothing();
    else await db.update(schema.users).set({ receiveLocationId: store.id }).where(and(eq(schema.users.email, RAJDANGA_EMAIL), sql`${schema.users.receiveLocationId} is null`));
  }
}

export async function loadDemo(u: CurrentUser) {
  if (u.role !== "ADMIN") throw new UserError("Only the admin can load demo data.");
  const have = await db.select().from(schema.fabricItems).where(inArray(schema.fabricItems.fabricNo, DEMO_FAB_NOS));
  if (have.length) throw new UserError("Demo data is already loaded (or a real fabric uses 990A, 990B, 991A, 991B or 992). Remove demo data first.");
  const day = (n: number) => new Date(Date.now() + 5.5 * 3600e3 - n * 864e5).toISOString().slice(0, 10);
  await ensureStarter();
  const locs = await db.select().from(schema.locations);
  for (const l of locs) {
    const d = DEMO_LOC_INFO[l.name]; if (!d) continue;
    await db.update(schema.locations).set({ address: l.address || d[0], zohoLocationId: l.zohoLocationId || d[1], contact: l.contact || d[2] }).where(eq(schema.locations.id, l.id));
  }
  const L = (name: string) => locs.find((l) => l.name === name)!.id;
  const G: Record<string, string> = {};
  for (const code of [...new Set(DEMO_FABRICS.map((f) => f[1]))]) {
    const name = `Fabric ${code} (DEMO)`;
    const [g0] = await db.select().from(schema.fabricGroups).where(eq(schema.fabricGroups.name, name));
    G[code] = (g0 ?? await saveGroup(u, { name, cwFabricCode: code, vendor: DEMO_FABRICS.find((f) => f[1] === code)![5] })).id;
  }
  for (const [i, f] of DEMO_FABRICS.entries())
    await db.insert(schema.fabricItems).values({ fabricNo: f[0], cwFabricCode: f[1], colour: f[2], itemName: `${f[3]} (DEMO)`, sku: f[4], vendor: f[5], hex: f[6],
      zohoItemId: `DEMO-2400000${i + 1}`, group: `Fabric ${f[1]} (DEMO)`, groupId: G[f[1]], unit: "kg" });
  // Incoming POs (in real use these come from Zoho / Carbonwork)
  const demoPOs: [string, string, [string, number, number][]][] = [
    ["CT26/PO/48", "RSWM (DEMO)", [["990A", 150, 6], ["990B", 100, 4]]], ["CT26/PO/69", "Sutlej (DEMO)", [["991A", 120, 4]]],
    ["CT26/PO/32", "Sutlej (DEMO)", [["991B", 90, 3]]], ["CT26/PO/45", "Nahar (DEMO)", [["992", 120, 3]]], ["CT26/PO/115", "RSWM (DEMO)", [["990A", 150, 6]]],
  ];
  for (const [po, vendor, ls] of demoPOs)
    await savePO(u, { poNumber: po, vendor, source: "DEMO", notes: "DEMO", lines: ls.map(([item, kg, rolls]) => ({ item, kg, rolls })) });
  const users = [
    { email: "store.demo@example.com", name: "Store (demo)", role: "INVENTORY" as const, locs: ["Rajdanga Storage", "Rajdanga Production"], pos: "" },
    { email: "merch.demo@example.com", name: "Merchandiser (demo)", role: "MERCHANDISER" as const, locs: ["Rajdanga Storage"], pos: "CT26/PO/88, CT26/PO/95" },
    { email: "viewer.demo@example.com", name: "Viewer (demo)", role: "VIEWER" as const, locs: [], pos: "" },
    { email: "oldadmin.demo@example.com", name: "Former admin (demo, switched off)", role: "ADMIN" as const, locs: [], pos: "", active: false },
  ];
  for (const x of users) {
    const [row] = await db.insert(schema.users).values({ email: x.email, name: x.name, role: x.role, stylePOPrefixes: x.pos || null, active: x.active ?? true, allLocations: x.role === "VIEWER" || x.role === "ADMIN" })
      .onConflictDoNothing().returning();
    if (row) for (const n of x.locs) await db.insert(schema.userLocations).values({ userId: row.id, locationId: L(n) });
  }

  // Receive fabric (each receipt = one batch)
  const R: Record<string, string[]> = {};
  let inv = 100;
  const rec = async (key: string, fab: string, po: string, loc: string, kgs: number[], date: string) => {
    const r = await receivePO(u, { fabricPO: po, invoiceNo: `INV-DEMO-${++inv}`, date, locationId: L(loc), note: "DEMO", lines: [{ item: fab, weights: kgs.map(String) }] });
    if (!r.ok) throw new Error("Demo receive failed: " + r.errors.join("; "));
    R[key] = r.batches[0].serials;
  };
  await rec("pg", "990A", "CT26/PO/48", "Rajdanga Storage", [24.6, 25.1, 23.8, 24.9, 25.4, 24.2], day(12));
  await rec("mp", "990B", "CT26/PO/48", "Rajdanga Storage", [26.1, 25.7, 24.8, 25.9], day(12));
  await rec("ch", "991A", "CT26/PO/69", "Rajdanga Storage", [30.2, 29.7, 31.0, 30.5], day(11));
  await rec("cb", "991B", "CT26/PO/32", "Exim", [28.4, 29.1, 27.9], day(11));
  await rec("bk", "992", "CT26/PO/45", "Exim", [41.0, 39.6, 40.3], day(10));
  await rec("new", "990A", "CT26/PO/115", "Rajdanga Storage", [25.0, 24.7, 25.3], day(0)); // left waiting for labels

  // Labels: at Rajdanga Storage the put-away scan activates them; at Exim they are scanned in on Activate labels
  const racks = ["R1-A", "R1-B", "R2-A", "R2-B", "R3-A"];
  let k = 0;
  for (const s of [...R.pg, ...R.mp, ...R.ch]) await putAwayScan(u, { rackCode: racks[k++ % racks.length], serial: s });
  await activateLabels(u, [...R.cb, ...R.bk]);

  // Orders, one shared number series
  const T: Record<string, string> = {};
  const post = async (key: string, p: Omit<TOInput, "sourceId" | "destinationId"> & { from: string; to: string }) => {
    const r = await postTO(u, { ...p, sourceId: L(p.from), destinationId: L(p.to) });
    if (!r.ok) throw new Error("Demo post failed: " + ("errors" in r && r.errors ? r.errors.join("; ") : "order number repeated"));
    T[key] = r.to;
  };
  type CLine = { item: string; kg: number; waste?: number; pieces?: number; orders?: string[] };
  /** A TROC needs the exact rolls taken out first: take out FIFO rolls for the style PO, then one TROC row per roll. */
  const troc = async (key: string, p: { date: string; stylePO: string; mo?: string; reason: string; lines: CLine[] }) => {
    const rows: TOInput["lines"] = [];
    for (const l of p.lines) {
      let need = Math.round((l.kg + (l.waste ?? 0)) * 1000);
      const pool = (await db.execute(sql`select r.serial, r.remaining_g g, r.taken_out_for t from rolls r join fabric_items f on f.id=r.fabric_item_id
        where f.fabric_no=${l.item} and r.current_location_id=${L("Rajdanga Storage")} and r.status='IN_STOCK'
          and (r.taken_out_at is null or (r.taken_out_purpose='PRODUCTION' and r.taken_out_for=${p.stylePO}))
        order by (r.taken_out_at is null), r.registered_date, r.created_at, r.serial`)).rows as { serial: string; g: number; t: string | null }[];
      const use: { serial: string; g: number }[] = [];
      for (const r of pool) { if (need <= 0) break; if (!r.t) { const t = await takeOut(u, { code: r.serial, purpose: "PRODUCTION", forPO: p.stylePO, confirmNotOldest: true }); if (t.kind !== "ok") throw new Error("Demo take-out failed: " + t.msg); }
        use.push({ serial: r.serial, g: Math.min(r.g, need) }); need -= Math.min(r.g, need); }
      if (need > 0) throw new Error(`Demo: not enough ${l.item} for ${key}`);
      const share = use.length === 1 ? [l.kg] : use.map((x, i) => i === use.length - 1 ? +(l.kg - use.slice(0, -1).reduce((a, y) => a + y.g / 1000, 0)).toFixed(3) : x.g / 1000);
      use.forEach((x, i) => rows.push({ item: l.item, serials: [x.serial], kg: share[i], waste: i === use.length - 1 ? l.waste ?? 0 : 0,
        pieces: i === 0 ? l.pieces ?? 0 : 0, orders: i === 0 ? l.orders ?? [] : [] }));
    }
    await post(key, { type: "CONSUMPTION", date: p.date, from: "Rajdanga Storage", to: "Rajdanga Production", stylePO: p.stylePO, mo: p.mo, reason: p.reason, recut: "not-recut", lines: rows });
  };
  const kgOf = async (fno: string, loc: string, n: number) => {
    const rows = (await db.execute(sql`select r.remaining_g g from rolls r join fabric_items f on f.id=r.fabric_item_id
      where f.fabric_no=${fno} and r.current_location_id=${L(loc)} and r.status='IN_STOCK' order by r.registered_date, r.created_at, r.serial limit ${n}`)).rows as { g: number }[];
    return String(rows.reduce((a, r) => a + r.g, 0) / 1000);
  };
  await post("a", { type: "TRANSFER", date: day(9), from: "Rajdanga Storage", to: "Amrit Impex", reason: "Stitching at Amrit (DEMO)", mo: "MO-DEMO-11", lines: [{ item: "990B", kg: await kgOf("990B", "Rajdanga Storage", 2) }] });
  await post("b", { type: "TRANSFER", date: day(8), from: "Exim", to: "Rajdanga Storage", reason: "Stock back to storage (DEMO)", lines: [{ item: "DM-SKU-3D2-CAR", kg: await kgOf("991B", "Exim", 1) }] });
  await troc("c", { date: day(7), stylePO: "CT26/PO/88", mo: "MO-DEMO-12", reason: "Cutting (DEMO)",
    lines: [{ item: "990A", kg: 5, waste: 0.4, pieces: 10, orders: ["#CT10231", "#CT10231", "#CT10245", "#CT10252", "#CT10252", "#CT10252", "#CT10260", "#CT10264", "#CT10271", "#CT10288"] }] });
  await post("d", { type: "TRANSFER", date: day(6), from: "Rajdanga Storage", to: "LUVKART", reason: "For CT26/PO/107 (DEMO)", invoice: "INV-DEMO-204", lines: [{ item: "991A", kg: 45 }] });
  await troc("e", { date: day(5), stylePO: "CT26/PO/95", reason: "Cutting (DEMO)",
    lines: [{ item: "990A", kg: 21.8, waste: 1.3, pieces: 6, orders: ["#CT10301", "#CT10302", "#CT10302", "#CT10305", "#CT10309", "#CT10311"] }] });
  await troc("f", { date: day(4), stylePO: "CT26/PO/87", reason: "Bulk cutting (DEMO)", lines: [{ item: "991A", kg: 30 }] });
  await troc("g", { date: day(3), stylePO: "CT26/PO/88", reason: "Cutting (DEMO)",
    lines: [{ item: "990A", kg: 4.2, waste: 0.3, pieces: 5, orders: ["#CT10320", "#CT10321", "#CT10322", "#CT10322", "#CT10325"] },
      { item: "990B", kg: 3, waste: 0.2, pieces: 3, orders: ["#CT10327", "#CT10330", "STOCK"] }] });
  await troc("j", { date: day(2), stylePO: "CT26/PO/95", mo: "MO-DEMO-15", reason: "Three colours, one cut (DEMO)",
    lines: [{ item: "990A", kg: 3.1, waste: 0.2, pieces: 4, orders: ["#CT10340", "#CT10341", "#CT10341", "#CT10344"] },
      { item: "991A", kg: 2.4, waste: 0.1, pieces: 3, orders: ["#CT10340", "#CT10346", "#CT10347"] },
      { item: "990B", kg: 1.6, waste: 0, pieces: 2, orders: ["#CT10341", "#CT10349"] }] });
  await post("h", { type: "TRANSFER", date: day(2), from: "Rajdanga Storage", to: "Exim", reason: "Wrong fabric picked (DEMO)", lines: [{ item: "990A", kg: 25 }] });
  T.hr = (await reverseTO(u, T.h, "Wrong fabric picked (DEMO)")).by;
  await post("i", { type: "TRANSFER", date: day(1), from: "Exim", to: "Anshuree", reason: "Polo run (DEMO)", mo: "MO-DEMO-14", invoice: "INV-DEMO-219", lines: [{ item: "DM-SKU-12-BLA", kg: 60 }] });
  // One TROR planned in the office, waiting for the warehouse to pick
  const pl = await planTROR(u, { type: "TRANSFER", date: day(0), sourceId: L("Rajdanga Storage"), destinationId: L("Siddhivinayak"), reason: "For CT26/PO/121 (DEMO)", lines: [{ item: "990A", kg: 30 }] });
  if (!pl.ok) throw new Error("Demo TROR plan failed: " + pl.errors.join("; "));
  T.plan = pl.to;
  // One roll taken out for sampling, not used yet
  const smp = (await db.execute(sql`select r.serial from rolls r join fabric_items f on f.id=r.fabric_item_id where f.fabric_no='990A' and r.status='IN_STOCK' and r.taken_out_at is null and r.rack_id is not null and r.remaining_g > 20000 order by r.registered_date desc, r.serial desc limit 1`)).rows[0] as { serial: string } | undefined;
  if (smp) await takeOut(u, { code: smp.serial, purpose: "SAMPLING", forPO: "", confirmNotOldest: true });

  // Adjustments: one applied (within limit), one waiting for approval, one rejected
  const lastRoll = async (fno: string, loc: string) => ((await db.execute(sql`select r.id, r.serial from rolls r join fabric_items f on f.id=r.fabric_item_id
      where f.fabric_no=${fno} and r.current_location_id=${L(loc)} and r.status='IN_STOCK' order by r.registered_date desc, r.created_at desc limit 1`)).rows[0] as { id: string; serial: string });
  const bk = await lastRoll("992", "Exim"), mp = await lastRoll("990B", "Rajdanga Storage"), cb = await lastRoll("991B", "Exim");
  await requestAdjustment(u, { serial: bk.serial, kgChangeG: -600, reason: "REWEIGHED", note: "DEMO: re-weighed on the floor scale" });
  await db.insert(schema.adjustments).values([
    { number: "ADJ-DEMO-0002", rollId: mp.id, kgChangeG: -3500, reason: "DAMAGED", note: "DEMO: water damage on the outer layers", photoUrl: "https://example.com/demo-photo", status: "PENDING", requestedBy: "store.demo@example.com" },
    { number: "ADJ-DEMO-0003", rollId: cb.id, kgChangeG: 4000, reason: "FOUND", note: "DEMO: extra kg found on the label", status: "REJECTED", requestedBy: "store.demo@example.com",
      requestedAt: new Date(Date.now() - 3 * 864e5), decidedBy: u.email, decidedAt: new Date(Date.now() - 2 * 864e5), decisionNote: "DEMO: re-weighed, no change" },
  ]);

  // "Entered in Zoho" ticked for the older TOs, so a few are still to enter
  await db.update(schema.transferOrders).set({ enteredInZoho: true, enteredInZohoAt: new Date(), enteredInZohoBy: u.email }).where(inArray(schema.transferOrders.toNumber, [T.a, T.b, T.c, T.d]));

  // Spot checks: an older one, and today's against a made-up Carbonwork file with a few gaps
  await db.insert(schema.checks).values({ fileDate: day(7), fileName: `fabric_stock_${day(7)}_DEMO.csv`, createdBy: u.email, rowsChecked: 11, rowsFlagged: 1, kgGapG: 400,
    rollsWeighed: 5, status: "DONE", notes: "DEMO: older check · 1 row off by a TRO not yet in Zoho", results: { rows: [], postedSinceFile: 0 }, createdAt: new Date(Date.now() - 7 * 864e5), finishedAt: new Date(Date.now() - 7 * 864e5) });
  const agg = (await db.execute(sql`select f.cw_fabric_code code, f.colour, coalesce(l.carbonwork_name, l.name) loc, sum(r.remaining_g)::int g
    from rolls r join fabric_items f on f.id=r.fabric_item_id join locations l on l.id=r.current_location_id where r.status <> 'FINISHED' group by 1,2,3 order by 1,2,3`)).rows as { code: string; colour: string; loc: string; g: number }[];
  const csv = ["snapshot_date,fabric,colour,location,here_kg", ...agg.map((a, i) => [todayIST(), a.code, a.colour, a.loc, ((a.g + (i === 0 ? -9800 : i === 2 ? 25000 : 0)) / 1000).toFixed(1)].join(",")),
    [todayIST(), "8D2", "Midnight Plum", "Siddhivinayak", "12.0"].join(",")].join("\n");
  const checkId = await createCheck(u, { stockName: `fabric_stock_${todayIST()}_DEMO.csv`, stockCsv: csv });
  const picks = (await db.execute(sql`select r.serial, s.sheet_g from spot_weighs s join rolls r on r.id=s.roll_id where s.check_id=${checkId}`)).rows as { serial: string; sheet_g: number }[];
  for (const [i, p] of picks.entries()) await recordWeigh(u, checkId, p.serial, i === 1 ? p.sheet_g - 700 : p.sheet_g);
  await finishCheck(u, checkId, "DEMO spot check");

  await db.transaction((tx) => writeAudit(tx, u, "DEMO_LOADED", "demo", null, { details: { tos: T } }));
  const [{ n }] = (await db.execute(sql`select count(*)::int n from rolls r join fabric_items f on f.id=r.fabric_item_id where f.fabric_no in (${sql.join(DEMO_FAB_NOS.map((x) => sql`${x}`), sql`, `)})`)).rows as { n: number }[];
  return { rolls: n, T };
}

/** Removes every demo row and demo-filled cell. Real data is not touched. The serial registry and Audit keep their history. */
export async function removeDemo(u: CurrentUser) {
  if (u.role !== "ADMIN") throw new UserError("Only the admin can remove demo data.");
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(424242)`);
    const fabs = await tx.select({ id: schema.fabricItems.id }).from(schema.fabricItems)
      .where(sql`${inArray(schema.fabricItems.fabricNo, DEMO_FAB_NOS)} or ${schema.fabricItems.sku} like 'DM-%'`);
    const fabIds = fabs.map((f) => f.id);
    if (fabIds.length) {
      const rollIds = (await tx.select({ id: schema.rolls.id }).from(schema.rolls).where(inArray(schema.rolls.fabricItemId, fabIds))).map((r) => r.id);
      const toIds = rollIds.length ? [...new Set((await tx.select({ t: schema.toLines.toId }).from(schema.toLines).where(inArray(schema.toLines.rollId, rollIds))).map((x) => x.t))] : [];
      if (rollIds.length) {
        await tx.delete(schema.rackMoves).where(inArray(schema.rackMoves.rollId, rollIds));
        await tx.delete(schema.spotWeighs).where(inArray(schema.spotWeighs.rollId, rollIds));
        await tx.delete(schema.adjustments).where(inArray(schema.adjustments.rollId, rollIds));
      }
      if (toIds.length) {
        await tx.delete(schema.toPicks).where(inArray(schema.toPicks.toId, toIds));
        await tx.delete(schema.orderLinks).where(inArray(schema.orderLinks.toId, toIds));
        await tx.delete(schema.toLines).where(inArray(schema.toLines.toId, toIds));
        await tx.delete(schema.toItems).where(inArray(schema.toItems.toId, toIds));
        await tx.update(schema.transferOrders).set({ reversalOfId: null }).where(inArray(schema.transferOrders.id, toIds));
        await tx.delete(schema.transferOrders).where(inArray(schema.transferOrders.id, toIds));
      }
      // planned TRORs that only reference demo fabrics (no roll moved yet)
      const planned = [...new Set((await tx.select({ t: schema.toItems.toId }).from(schema.toItems).where(inArray(schema.toItems.fabricItemId, fabIds))).map((x) => x.t))];
      if (planned.length) {
        await tx.delete(schema.toPicks).where(inArray(schema.toPicks.toId, planned));
        await tx.delete(schema.toItems).where(inArray(schema.toItems.toId, planned));
        await tx.delete(schema.transferOrders).where(and(inArray(schema.transferOrders.id, planned), sql`${schema.transferOrders.status} <> 'POSTED'`));
      }
      await tx.delete(schema.toItems).where(inArray(schema.toItems.fabricItemId, fabIds));
      await tx.delete(schema.poLines).where(inArray(schema.poLines.fabricItemId, fabIds));
      await tx.update(schema.rolls).set({ splitFromId: null }).where(inArray(schema.rolls.fabricItemId, fabIds));
      await tx.delete(schema.rolls).where(inArray(schema.rolls.fabricItemId, fabIds));
      await tx.delete(schema.batches).where(inArray(schema.batches.fabricItemId, fabIds));
      await tx.delete(schema.fabricItems).where(inArray(schema.fabricItems.id, fabIds));
    }
    await tx.delete(schema.receipts).where(like(schema.receipts.invoiceNo, "INV-DEMO-%"));
    await tx.execute(sql`delete from purchase_orders p where p.source = 'DEMO' and not exists (select 1 from po_lines l where l.po_id = p.id)`);
    await tx.execute(sql`update fabric_groups set pair_group_id = null where pair_group_id in (select id from fabric_groups where name like '% (DEMO)')`);
    await tx.execute(sql`delete from fabric_groups g where g.name like '% (DEMO)' and not exists (select 1 from fabric_items i where i.group_id = g.id)`);
    const demoChecks = (await tx.select({ id: schema.checks.id }).from(schema.checks).where(like(schema.checks.fileName, "%_DEMO.csv"))).map((c) => c.id);
    if (demoChecks.length) { await tx.delete(schema.spotWeighs).where(inArray(schema.spotWeighs.checkId, demoChecks)); await tx.delete(schema.checks).where(inArray(schema.checks.id, demoChecks)); }
    await tx.delete(schema.users).where(like(schema.users.email, "%@example.com"));
    for (const l of await tx.select().from(schema.locations)) {
      const f: Record<string, null> = {};
      for (const k of ["address", "zohoLocationId", "contact"] as const) if (/DEMO/.test(String(l[k] ?? ""))) f[k] = null;
      if (Object.keys(f).length) await tx.update(schema.locations).set(f).where(eq(schema.locations.id, l.id));
    }
    // the series goes back to the highest real TO (0 if none): no real number is ever reused
    const [{ m }] = (await tx.execute(sql`select coalesce(max(substring(to_number from 6)::int),0)::int m from transfer_orders`)).rows as { m: number }[];
    await tx.insert(schema.counters).values({ name: "to", value: m }).onConflictDoUpdate({ target: schema.counters.name, set: { value: m } });
    await writeAudit(tx, u, "DEMO_REMOVED", "demo", null, {});
    void and; void notInArray;
  });
}
