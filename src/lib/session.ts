import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { UserError } from "./errors";

import type { CurrentUser, Role } from "./perm";
export type { CurrentUser, Role } from "./perm";
export { canPostLocation, canUseStylePO } from "./perm";

/** Looks the person up in Users on every request — roles are never trusted from the browser. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;
  const u = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (!u || !u.active) return null;
  const locs = await db.select({ id: schema.userLocations.locationId }).from(schema.userLocations).where(eq(schema.userLocations.userId, u.id));
  const admin = u.role === "ADMIN";
  return {
    id: u.id, email: u.email, name: u.name, role: u.role,
    allLocations: admin || u.allLocations,
    allStylePOs: admin || u.allStylePOs,
    locationIds: locs.map((l) => l.id),
    stylePOCodes: (u.stylePOPrefixes ?? "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean),
  };
});

/** For pages: redirect when not signed in / not allowed. */
export async function pageUser(roles?: Role[]) {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (roles && !roles.includes(u.role)) redirect("/?denied=1");
  return u;
}

/** For server actions: throw a readable error when not allowed. */
export async function actionUser(roles?: Role[]) {
  const u = await getCurrentUser();
  if (!u) throw new UserError("You are signed out. Sign in again.");
  if (roles && !roles.includes(u.role)) throw new UserError(`Your role (${u.role}) can't do this.`);
  return u;
}


export const NAV_ROLES = {
  transfer: ["ADMIN", "INVENTORY"] as Role[],
  consumption: ["ADMIN", "MERCHANDISER"] as Role[],
  register: ["ADMIN", "INVENTORY"] as Role[],
  labels: ["ADMIN"] as Role[],
  activate: ["ADMIN", "INVENTORY"] as Role[],
  adjust: ["ADMIN", "INVENTORY"] as Role[],
  approve: ["ADMIN"] as Role[],
  check: ["ADMIN", "INVENTORY"] as Role[],
  log: ["ADMIN", "INVENTORY", "MERCHANDISER"] as Role[],
  find: ["ADMIN", "INVENTORY", "MERCHANDISER", "VIEWER"] as Role[],
  masters: ["ADMIN"] as Role[],
};
