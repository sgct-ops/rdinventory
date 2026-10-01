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

/** Starter locations + racks (safe to run again). */
export async function ensureStarter() {
  for (const [code, name, type] of STARTER_LOCATIONS)
    await db.insert(schema.locations).values({ code, name, type, carbonworkName: name }).onConflictDoNothing();
  const [store] = await db.select().from(schema.locations).where(eq(schema.locations.name, "Rajdanga Storage"));
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from racks`)).rows as { n: number }[];
  if (store && !n) for (const [i, [code, room, building]] of STARTER_RACKS.entries())
    await db.insert(schema.racks).values({ code, room, building, locationId: store.id, capacity: 48, sortOrder: i }).onConflictDoNothing();
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
  for (const [i, f] of DEMO_FABRICS.entries())
    await db.insert(schema.fabricItems).values({ fabricNo: f[0], cwFabricCode: f[1], colour: f[2], itemName: `${f[3]} (DEMO)`, sku: f[4], vendor: f[5], hex: f[6],
      zohoItemId: `DEMO-2400000${i + 1}`, group: `Fabric ${f[1]}`, unit: "kg" });
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
  const rec = async (key: string, fab: string, po: string, loc: string, kgs: number[], date: string) => {
    const r = await receivePO(u, { fabricPO: po, date, locationId: L(loc), weighedBy: "Store (demo)", note: "DEMO", lines: [{ item: fab, weights: kgs.map(String) }] });
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
    if (!r.ok) throw new Error("Demo post failed: " + r.errors.join("; "));
    T[key] = r.to;
  };
  const kgOf = async (fno: string, loc: string, n: number) => {
    const rows = (await db.execute(sql`select r.remaining_g g from rolls r join fabric_items f on f.id=r.fabric_item_id
      where f.fabric_no=${fno} and r.current_location_id=${L(loc)} and r.status='IN_STOCK' order by r.registered_date, r.created_at, r.serial limit ${n}`)).rows as { g: number }[];
    return String(rows.reduce((a, r) => a + r.g, 0) / 1000);
  };
  await post("a", { type: "TRANSFER", date: day(9), from: "Rajdanga Storage", to: "Amrit Impex", reason: "Stitching at Amrit (DEMO)", mo: "MO-DEMO-11", lines: [{ item: "990B", kg: await kgOf("990B", "Rajdanga Storage", 2) }] });
  await post("b", { type: "TRANSFER", date: day(8), from: "Exim", to: "Rajdanga Storage", reason: "Stock back to storage (DEMO)", lines: [{ item: "DM-SKU-3D2-CAR", kg: await kgOf("991B", "Exim", 1) }] });
  await post("c", { type: "CONSUMPTION", date: day(7), from: "Rajdanga Storage", to: "Rajdanga Production", stylePO: "CT26/PO/88", mo: "MO-DEMO-12", reason: "Cutting (DEMO)",
    lines: [{ item: "990A", kg: 5, waste: 0.4, pieces: 10, orders: ["#CT10231", "#CT10231", "#CT10245", "#CT10252", "#CT10252", "#CT10252", "#CT10260", "#CT10264", "#CT10271", "#CT10288"] }] });
  await post("d", { type: "TRANSFER", date: day(6), from: "Rajdanga Storage", to: "LUVKART", reason: "For CT26/PO/107 (DEMO)", invoice: "INV-DEMO-204", lines: [{ item: "991A", kg: 45 }] });
  await post("e", { type: "CONSUMPTION", date: day(5), from: "Rajdanga Storage", to: "Rajdanga Production", stylePO: "CT26/PO/95", reason: "Cutting (DEMO)",
    lines: [{ item: "DM-SKU-8D2-PIN", kg: 21.8, waste: 1.3, pieces: 6, orders: ["#CT10301", "#CT10302", "#CT10302", "#CT10305", "#CT10309", "#CT10311"] }] });
  await post("f", { type: "CONSUMPTION", date: day(4), from: "Rajdanga Storage", to: "Rajdanga Production", stylePO: "CT26/PO/87", reason: "Bulk cutting (DEMO)", lines: [{ item: "991A", kg: 30 }] });
  await post("g", { type: "CONSUMPTION", date: day(3), from: "Rajdanga Storage", to: "Rajdanga Production", stylePO: "CT26/PO/88", reason: "Cutting (DEMO)",
    lines: [{ item: "990A", kg: 4.2, waste: 0.3, pieces: 5, orders: ["#CT10320", "#CT10321", "#CT10322", "#CT10322", "#CT10325"] },
      { item: "990B", kg: 3, waste: 0.2, pieces: 3, orders: ["#CT10327", "#CT10330", "STOCK"] }] });
  await post("j", { type: "CONSUMPTION", date: day(2), from: "Rajdanga Storage", to: "Rajdanga Production", stylePO: "CT26/PO/95", mo: "MO-DEMO-15", reason: "Three colours, one cut (DEMO)",
    lines: [{ item: "990A", kg: 3.1, waste: 0.2, pieces: 4, orders: ["#CT10340", "#CT10341", "#CT10341", "#CT10344"] },
      { item: "991A", kg: 2.4, waste: 0.1, pieces: 3, orders: ["#CT10340", "#CT10346", "#CT10347"] },
      { item: "990B", kg: 1.6, waste: 0, pieces: 2, orders: ["#CT10341", "#CT10349"] }] });
  await post("h", { type: "TRANSFER", date: day(2), from: "Rajdanga Storage", to: "Exim", reason: "Wrong fabric picked (DEMO)", lines: [{ item: "990A", kg: 25 }] });
  T.hr = (await reverseTO(u, T.h, "Wrong fabric picked (DEMO)")).by;
  await post("i", { type: "TRANSFER", date: day(1), from: "Exim", to: "Anshuree", reason: "Polo run (DEMO)", mo: "MO-DEMO-14", invoice: "INV-DEMO-219", lines: [{ item: "DM-SKU-12-BLA", kg: 60 }] });

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
        await tx.delete(schema.orderLinks).where(inArray(schema.orderLinks.toId, toIds));
        await tx.delete(schema.toLines).where(inArray(schema.toLines.toId, toIds));
        await tx.delete(schema.toItems).where(inArray(schema.toItems.toId, toIds));
        await tx.update(schema.transferOrders).set({ reversalOfId: null }).where(inArray(schema.transferOrders.id, toIds));
        await tx.delete(schema.transferOrders).where(inArray(schema.transferOrders.id, toIds));
      }
      await tx.delete(schema.toItems).where(inArray(schema.toItems.fabricItemId, fabIds));
      await tx.update(schema.rolls).set({ splitFromId: null }).where(inArray(schema.rolls.fabricItemId, fabIds));
      await tx.delete(schema.rolls).where(inArray(schema.rolls.fabricItemId, fabIds));
      await tx.delete(schema.batches).where(inArray(schema.batches.fabricItemId, fabIds));
      await tx.delete(schema.fabricItems).where(inArray(schema.fabricItems.id, fabIds));
    }
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
