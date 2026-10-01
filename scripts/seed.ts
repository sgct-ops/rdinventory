/**
 * npm run seed        → starter locations, the 8 racks (R1-A … R4-B), first admin (safe to re-run)
 * npm run seed:demo   → also the sheet's demo data (TEST COPY ONLY; Admin → Tools → Remove demo data takes it out)
 */
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db";
import { ensureStarter, loadDemo } from "../src/lib/demo";
import type { CurrentUser } from "../src/lib/perm";

async function main() {
  await ensureStarter();
  const admins = (process.env.ADMIN_EMAILS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  for (const e of admins) await db.insert(schema.users).values({ email: e, role: "ADMIN", allLocations: true, allStylePOs: true }).onConflictDoNothing();
  console.log("Base data ready");
  if (!process.argv.includes("--demo")) return;
  if (process.env.APP_ENV !== "test" && !process.argv.includes("--force")) throw new Error("Demo data is for the test copy. Set APP_ENV=test (or pass --force).");
  const [a] = await db.select().from(schema.users).where(eq(schema.users.email, admins[0] ?? ""));
  if (!a) throw new Error("Set ADMIN_EMAILS first.");
  const u: CurrentUser = { id: a.id, email: a.email, name: a.name ?? "Admin", role: "ADMIN", allLocations: true, allStylePOs: true, locationIds: [], stylePOCodes: [] };
  const r = await loadDemo(u);
  // test logins for DEV_LOGIN
  const locs = await db.select().from(schema.locations);
  for (const [email, role, names, pos] of [["inventory@test.local", "INVENTORY", ["Rajdanga Storage", "Rajdanga Production", "Exim", "Amrit Impex"], ""],
    ["merch@test.local", "MERCHANDISER", ["Rajdanga Storage"], "CT26/PO/"], ["viewer@test.local", "VIEWER", [], ""]] as const) {
    const [row] = await db.insert(schema.users).values({ email, role, name: `${role.toLowerCase()} (test)`, stylePOPrefixes: pos || null }).onConflictDoNothing().returning();
    if (row) for (const n of names) await db.insert(schema.userLocations).values({ userId: row.id, locationId: locs.find((l) => l.name === n)!.id });
  }
  console.log(`Demo data ready: ${r.rolls} rolls, orders ${Object.values(r.T).join(", ")}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
