"use server";
import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { run, UserError } from "@/lib/errors";
import { actionUser } from "@/lib/session";
import { writeAudit } from "@/lib/tx";
import { parseCsv, pick } from "@/lib/csv";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { FMT, LOCATION_TYPES } from "@/lib/formats";
import { runBackup, runHealthCheck } from "@/lib/health";

const admin = () => actionUser(["ADMIN"]);
const s = (v: FormDataEntryValue | null) => (v === null ? "" : String(v).trim());
const orNull = (v: FormDataEntryValue | null) => s(v) || null;
/** hidden "off" + checkbox "on" pattern; forms without the field default to active */
const activeOf = (fd: FormData) => { const v = fd.getAll("active").map(String); return v.length ? v.includes("on") : true; };
async function audit(email: string, action: string, entity: string, id: string | null, details?: unknown) {
  await db.transaction((tx) => writeAudit(tx, { email }, action, entity, id, { details }));
}

// ------------------------------------------------ Fabric Inventory
export async function saveFabricAction(_: unknown, fd: FormData) {
  return run(async () => {
    const u = await admin();
    const id = s(fd.get("id"));
    const fabricNo = orNull(fd.get("fabricNo"))?.toUpperCase() ?? null;
    if (fabricNo && !FMT.fabricNo.test(fabricNo)) throw new UserError("Rajdanga Fabric #: a number, optionally with letters after it (55, 55A, 55B).");
    const hex = orNull(fd.get("hex"));
    if (hex && !/^#[0-9a-f]{6}$/i.test(hex)) throw new UserError("Colour swatch must look like #24304f");
    const values = {
      itemName: s(fd.get("itemName")), sku: orNull(fd.get("sku")), group: orNull(fd.get("group")),
      cwFabricCode: orNull(fd.get("cwFabricCode")), colour: orNull(fd.get("colour")), fabricNo,
      unit: s(fd.get("unit")) || "kg", vendor: orNull(fd.get("vendor")), zohoItemId: orNull(fd.get("zohoItemId")), hex,
      active: activeOf(fd),
    };
    if (!values.itemName) throw new UserError("Zoho item name is required.");
    if (values.sku) {
      const [dup] = await db.select({ id: schema.fabricItems.id }).from(schema.fabricItems).where(sql`upper(${schema.fabricItems.sku}) = ${values.sku.toUpperCase()} and ${schema.fabricItems.id} <> ${id || ""}`);
      if (dup) throw new UserError(`SKU ${values.sku} is already used by another fabric.`);
    }
    if (id) {
      const [before] = await db.select().from(schema.fabricItems).where(eq(schema.fabricItems.id, id));
      if (before?.fabricNo && before.fabricNo !== fabricNo) {
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.rolls).where(eq(schema.rolls.fabricItemId, id));
        if (Number(n) > 0) throw new UserError("Fabric # can't change once rolls are registered — serials and labels use it.");
      }
      await db.update(schema.fabricItems).set(values).where(eq(schema.fabricItems.id, id));
      await audit(u.email, "FABRIC_EDITED", "fabric", id, { before, after: values });
    } else {
      const [r] = await db.insert(schema.fabricItems).values(values).returning();
      await audit(u.email, "FABRIC_ADDED", "fabric", r.id, values);
    }
    revalidatePath("/admin/fabrics");
  }, "Saved");
}

/** Zoho item export (CSV). Upserts by Item ID; never overwrites Fabric # already set. */
export async function importFabricsAction(_: unknown, fd: FormData) {
  return run(async () => {
    const u = await admin();
    const file = fd.get("file") as File | null;
    if (!file || !file.size) throw new UserError("Choose the Zoho items CSV.");
    const rows = parseCsv(await file.text());
    if (!rows.length) throw new UserError("Empty file.");
    const h = Object.keys(rows[0]);
    const H = {
      id: pick(h, ["Item ID", "item_id", "zoho item id"]), sku: pick(h, ["SKU"]), name: pick(h, ["Item Name", "Name", "item_name"]),
      group: pick(h, ["Group Name", "Item Group", "Category", "group"]), unit: pick(h, ["Unit", "Usage unit"]),
      vendor: pick(h, ["Vendor", "Preferred Vendor", "Vendor Name"]), code: pick(h, ["Carbonwork fabric code", "cw_fabric_code", "fabric code"]),
      colour: pick(h, ["Colour", "Color", "Attribute Option Name1"]), fno: pick(h, ["Rajdanga Fabric #", "Fabric #", "fabric_no"]),
    };
    if (!H.name) throw new UserError(`No "Item Name" column. Found: ${h.join(", ")}`);
    let added = 0, updated = 0;
    for (const r of rows) {
      const name = r[H.name]?.trim(); if (!name) continue;
      const v = {
        zohoItemId: H.id ? r[H.id]?.trim() || null : null, sku: H.sku ? r[H.sku]?.trim() || null : null, itemName: name,
        group: H.group ? r[H.group]?.trim() || null : null, unit: (H.unit && r[H.unit]?.trim()) || "kg",
        vendor: H.vendor ? r[H.vendor]?.trim() || null : null,
      };
      const extra = {
        ...(H.code && r[H.code]?.trim() ? { cwFabricCode: r[H.code].trim() } : {}),
        ...(H.colour && r[H.colour]?.trim() ? { colour: r[H.colour].trim() } : {}),
      };
      const existing = v.zohoItemId ? (await db.select().from(schema.fabricItems).where(eq(schema.fabricItems.zohoItemId, v.zohoItemId)))[0] : undefined;
      if (existing) {
        await db.update(schema.fabricItems).set({ ...v, ...extra, ...(!existing.fabricNo && H.fno && r[H.fno]?.trim() ? { fabricNo: r[H.fno].trim().toUpperCase() } : {}) })
          .where(eq(schema.fabricItems.id, existing.id));
        updated++;
      } else {
        await db.insert(schema.fabricItems).values({ ...v, ...extra, fabricNo: H.fno ? r[H.fno]?.trim().toUpperCase() || null : null });
        added++;
      }
    }
    await audit(u.email, "FABRICS_IMPORTED", "fabric", null, { added, updated, file: file.name });
    revalidatePath("/admin/fabrics");
    return { added, updated };
  }, "Imported");
}

// ------------------------------------------------ Locations
const LOC_TYPES = LOCATION_TYPES;
export async function saveLocationAction(_: unknown, fd: FormData) {
  return run(async () => {
    const u = await admin();
    const id = s(fd.get("id"));
    const type = s(fd.get("type")).toUpperCase() as (typeof LOC_TYPES)[number];
    if (!LOC_TYPES.includes(type)) throw new UserError("Pick a type.");
    const values = {
      code: s(fd.get("code")).toUpperCase(), name: s(fd.get("name")), type, address: orNull(fd.get("address")),
      zohoLocationId: orNull(fd.get("zohoLocationId")), contact: orNull(fd.get("contact")), carbonworkName: orNull(fd.get("carbonworkName")),
      active: activeOf(fd),
    };
    if (!values.code || !values.name) throw new UserError("Code and name are required.");
    if (id) await db.update(schema.locations).set(values).where(eq(schema.locations.id, id));
    else await db.insert(schema.locations).values(values);
    await audit(u.email, id ? "LOCATION_EDITED" : "LOCATION_ADDED", "location", id || null, values);
    revalidatePath("/admin/locations");
  }, "Saved");
}
export async function importLocationsAction(_: unknown, fd: FormData) {
  return run(async () => {
    const u = await admin();
    const file = fd.get("file") as File | null;
    if (!file || !file.size) throw new UserError("Choose the Zoho locations CSV.");
    const rows = parseCsv(await file.text());
    const h = rows.length ? Object.keys(rows[0]) : [];
    const H = { id: pick(h, ["Location ID", "Warehouse ID", "location_id"]), name: pick(h, ["Location Name", "Warehouse Name", "Name"]),
      type: pick(h, ["Type"]), address: pick(h, ["Address", "Street"]), contact: pick(h, ["Contact", "Phone", "Email"]), code: pick(h, ["Code"]) };
    if (!H.name) throw new UserError(`No name column. Found: ${h.join(", ")}`);
    let n = 0;
    for (const r of rows) {
      const name = r[H.name]?.trim(); if (!name) continue;
      const t = (H.type ? r[H.type] : "").toUpperCase();
      const type = (LOC_TYPES.find((x) => t.includes(x)) ?? "STORAGE") as (typeof LOC_TYPES)[number];
      const code = (H.code && r[H.code]?.trim()) || name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 20);
      const v = { name, code, type, zohoLocationId: H.id ? r[H.id]?.trim() || null : null,
        address: H.address ? r[H.address]?.trim() || null : null, contact: H.contact ? r[H.contact]?.trim() || null : null };
      await db.insert(schema.locations).values(v).onConflictDoUpdate({ target: schema.locations.name, set: { zohoLocationId: v.zohoLocationId, address: v.address, contact: v.contact } });
      n++;
    }
    await audit(u.email, "LOCATIONS_IMPORTED", "location", null, { n });
    revalidatePath("/admin/locations");
    return n;
  }, "Imported");
}

// ------------------------------------------------ Racks
export async function saveRackAction(_: unknown, fd: FormData) {
  return run(async () => {
    const u = await admin();
    const id = s(fd.get("id"));
    const code = s(fd.get("code")).toUpperCase().replace(/^RK-/, "");
    if (!/^[A-Z0-9][A-Z0-9-]{0,15}$/.test(code)) throw new UserError("Rack code: letters, digits and - (e.g. R1-A).");
    const capacity = Number(s(fd.get("capacity")) || 48);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) throw new UserError("Capacity must be 1–1000 rolls.");
    const values = {
      code, locationId: s(fd.get("locationId")), room: s(fd.get("room")), building: s(fd.get("building")),
      capacity, sortOrder: Number(s(fd.get("sortOrder")) || 0),
      active: activeOf(fd),
    };
    if (!values.locationId || !values.room || !values.building) throw new UserError("Location, room and building are required.");
    if (id) {
      if (!values.active) {
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.rolls).where(eq(schema.rolls.rackId, id));
        if (Number(n) > 0) throw new UserError(`Move the ${n} roll(s) off this rack before deactivating it.`);
      }
      await db.update(schema.racks).set(values).where(eq(schema.racks.id, id));
    } else await db.insert(schema.racks).values(values);
    await audit(u.email, id ? "RACK_EDITED" : "RACK_ADDED", "rack", id || null, values);
    revalidatePath("/admin/racks"); revalidatePath("/warehouse");
  }, "Saved");
}

// ------------------------------------------------ Users
const ROLES = ["ADMIN", "INVENTORY", "MERCHANDISER", "VIEWER"] as const;
export async function saveUserAction(_: unknown, fd: FormData) {
  return run(async () => {
    const u = await admin();
    const id = s(fd.get("id"));
    const email = s(fd.get("email")).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError("Enter a valid Google email.");
    const role = s(fd.get("role")) as (typeof ROLES)[number];
    if (!ROLES.includes(role)) throw new UserError("Pick a role.");
    if (id === u.id && role !== "ADMIN") throw new UserError("You can't remove your own admin role.");
    const active = fd.get("active") === "on";
    if (id === u.id && !active) throw new UserError("You can't deactivate yourself.");
    const prefixes = s(fd.get("stylePOPrefixes")).split(/[,;\n]/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    const values = { email, name: orNull(fd.get("name")), role, active, allLocations: fd.get("allLocations") === "on", allStylePOs: fd.get("allStylePOs") === "on",
      stylePOPrefixes: prefixes.join(", ") || null };
    const locIds = fd.getAll("locationIds").map(String);
    await db.transaction(async (tx) => {
      let userId = id;
      if (id) await tx.update(schema.users).set(values).where(eq(schema.users.id, id));
      else userId = (await tx.insert(schema.users).values(values).returning())[0].id;
      await tx.delete(schema.userLocations).where(eq(schema.userLocations.userId, userId));
      if (locIds.length) await tx.insert(schema.userLocations).values(locIds.map((locationId) => ({ userId, locationId })));
      await writeAudit(tx, u, id ? "USER_EDITED" : "USER_ADDED", "user", userId, { details: { ...values, locIds } });
    });
    revalidatePath("/admin/users");
  }, "Saved");
}

// ------------------------------------------------ Settings, backup, health
export async function saveSettingsAction(_: unknown, fd: FormData) {
  return run(async () => {
    const u = await admin();
    const nums = ["adjLimitKg", "adjLimitPct", "labelWidthMm", "labelHeightMm", "checkTolKg", "checkTolPct", "undoMinutes", "lowStockKg", "rackFullPct", "spotCheckRolls"];
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (k === "formatNotes") continue;
      const v = s(fd.get(k));
      if (!v) continue;
      if (nums.includes(k) && !(Number(v) >= 0)) throw new UserError(`${k} must be a number.`);
      if (k === "adjLimitRule" && !["SMALLER", "LARGER"].includes(v)) throw new UserError("Bad rule.");
      if (k === "orderNumberPattern") { try { new RegExp(v); } catch { throw new UserError("Order number pattern is not a valid regular expression."); } }
      await db.insert(schema.settings).values({ key: k, value: v }).onConflictDoUpdate({ target: schema.settings.key, set: { value: v } });
    }
    await audit(u.email, "SETTINGS_SAVED", "settings", null, Object.fromEntries(fd.entries()));
    revalidatePath("/admin/settings");
  }, "Saved");
}
export async function backupNowAction() {
  return run(async () => { await admin(); const r = await runBackup(); revalidatePath("/admin/backups"); return r; }, "Backup saved");
}
export async function healthNowAction() {
  return run(async () => { await admin(); await runHealthCheck(); revalidatePath("/"); revalidatePath("/admin/backups"); }, "Health check done");
}

/** Formats page: your wished-for format per field (like the sheet's "Your format" column). */
export async function saveFormatNoteAction(field: string, note: string) {
  return run(async () => {
    const u = await admin();
    const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, "formatNotes"));
    const notes = row ? (JSON.parse(row.value) as Record<string, string>) : {};
    if (note.trim()) notes[field] = note.trim().slice(0, 1000); else delete notes[field];
    const value = JSON.stringify(notes);
    await db.insert(schema.settings).values({ key: "formatNotes", value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } });
    await audit(u.email, "FORMAT_NOTE", "settings", null, { field, note });
    revalidatePath("/formats");
  });
}
