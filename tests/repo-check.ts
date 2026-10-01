// Fabric repository numbering rules. Run: DATABASE_URL=... npx tsx --conditions=react-server tests/repo-check.ts
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db";
import { saveGroup, addColour, suggestFor } from "../src/lib/fabrics";
import type { CurrentUser } from "../src/lib/perm";
const u: CurrentUser = { id: "t", email: "e2e@test.local", name: "e2e", role: "ADMIN", allLocations: true, allStylePOs: true, locationIds: [], stylePOCodes: [] };
let fails = 0; const check = (c: boolean, m: string) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
async function main() {
const tag = String(Date.now()).slice(-5);
const sj = await saveGroup(u, { name: `Fabric T${tag}` });
const rib = await saveGroup(u, { name: `Fabric T${tag} Rib` });
check(rib.kind === "RIB" && rib.pairGroupId === sj.id, "rib group detected and paired by name");
const a = await addColour(u, { groupId: sj.id, colour: "Pine Green" });
const s1 = await suggestFor(rib.id, "pine green");
check(s1.fabricNo === `${a.fabricNo}B`, `rib of the same colour → ${a.fabricNo}B (got ${s1.fabricNo})`);
const b = await addColour(u, { groupId: rib.id, colour: "Pine Green" });
check(b.fabricNo === `${a.fabricNo}B` && !!b.sku, `rib saved as ${b.fabricNo}, SKU ${b.sku}`);
let dup = ""; try { await addColour(u, { groupId: sj.id, colour: "PINE GREEN" }); } catch (e) { dup = (e as Error).message; }
check(/already has/.test(dup), "colour is unique inside a group");
const r2 = await addColour(u, { groupId: rib.id, colour: "Navy" }); const r2no = r2.fabricNo ?? "";
const s2 = await suggestFor(sj.id, "Navy");
check(r2no.endsWith("B") && s2.fabricNo === r2no.replace(/B$/, ""), `rib first (${r2no}) → single jersey later takes ${s2.fabricNo}`);
const m = await addColour(u, { groupId: sj.id, colour: "Chalk", fabricNo: `9${tag}A`, sku: `MAN-${tag}` });
check(m.fabricNo === `9${tag}A` && m.sku === `MAN-${tag}`, "manual Fabric # and SKU are kept");
for (const g of [sj, rib]) { await db.delete(schema.fabricItems).where(eq(schema.fabricItems.groupId, g.id)); }
await db.update(schema.fabricGroups).set({ pairGroupId: null }).where(eq(schema.fabricGroups.id, sj.id));
await db.delete(schema.fabricGroups).where(eq(schema.fabricGroups.id, rib.id)); await db.delete(schema.fabricGroups).where(eq(schema.fabricGroups.id, sj.id));
console.log(fails ? `${fails} FAILURE(S)` : "ALL PASSED"); process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
