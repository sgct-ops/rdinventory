import "server-only";
import { and, asc, eq, isNotNull, like } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CurrentUser } from "./perm";

export async function allowedLocations(u: CurrentUser) {
  const locs = await db.select().from(schema.locations).where(eq(schema.locations.active, true)).orderBy(asc(schema.locations.name));
  return locs.filter((l) => u.allLocations || u.locationIds.includes(l.id));
}
export async function activeLocations() {
  return db.select().from(schema.locations).where(eq(schema.locations.active, true)).orderBy(asc(schema.locations.name));
}
export async function fabricOptions() {
  const f = await db.select().from(schema.fabricItems).where(and(eq(schema.fabricItems.active, true), isNotNull(schema.fabricItems.fabricNo))).orderBy(asc(schema.fabricItems.fabricNo));
  return f.map((x) => ({ id: x.id, fabricNo: x.fabricNo!, sku: x.sku, fabric: x.cwFabricCode ?? x.itemName, colour: x.colour ?? "", label: `${x.cwFabricCode ?? x.itemName}${x.colour ? " · " + x.colour : ""}` }));
}
export async function getDraft(u: CurrentUser, kind: string) {
  const [d] = await db.select().from(schema.drafts).where(and(eq(schema.drafts.userId, u.id), eq(schema.drafts.kind, kind)));
  return d?.data ?? null;
}
export async function batchMax() {
  const rows = await db.select({ c: schema.batches.code }).from(schema.batches).where(like(schema.batches.code, "B-%"));
  const m: Record<string, number> = {};
  for (const r of rows) { const x = r.c.match(/^(.*-)(\d+)$/); if (x) m[x[1]] = Math.max(m[x[1]] ?? 0, Number(x[2])); }
  return m;
}
