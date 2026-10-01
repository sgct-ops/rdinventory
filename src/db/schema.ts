// Rajdanga fabric inventory — the source of truth.
// All weights are stored as integer GRAMS (kg × 1000) so sums never drift.
import {
  pgTable, pgEnum, text, integer, boolean, timestamp, date, jsonb,
  uniqueIndex, index, primaryKey, customType,
} from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const now = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const roleEnum = pgEnum("role", ["ADMIN", "INVENTORY", "MERCHANDISER", "VIEWER"]);
export const locationTypeEnum = pgEnum("location_type", ["STORAGE", "FACTORY", "PRODUCTION", "VENDOR", "OFFICE"]);
export const rollStatusEnum = pgEnum("roll_status", ["AWAITING_LABEL", "IN_STOCK", "FINISHED"]);
export const toTypeEnum = pgEnum("to_type", ["TRANSFER", "CONSUMPTION"]);
export const adjReasonEnum = pgEnum("adj_reason", [
  "REWEIGHED", "DAMAGED", "WASTAGE_NOT_ON_TO", "FOUND", "LOST",
  "SPOT_CHECK_CORRECTION", "OPENING_STOCK_CORRECTION", "OTHER",
]);
export const adjStatusEnum = pgEnum("adj_status", ["PENDING", "APPROVED", "REJECTED"]);

// ---------- Masters ----------

/** Tab 9 — Locations */
export const locations = pgTable("locations", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull().unique(),
  type: locationTypeEnum("type").notNull(),
  address: text("address"),
  zohoLocationId: text("zoho_location_id").unique(),
  contact: text("contact"),
  /** Name as it appears in Carbonwork's fabric_stock CSV, if different */
  carbonworkName: text("carbonwork_name"),
  active: boolean("active").notNull().default(true),
  createdAt: now("created_at"),
});

/** Tab 8 — Fabric Inventory (one row per fabric × colour) */
export const fabricItems = pgTable("fabric_items", {
  id: id(),
  zohoItemId: text("zoho_item_id").unique(),
  sku: text("sku"),
  itemName: text("item_name").notNull(),
  group: text("group_name"),
  cwFabricCode: text("cw_fabric_code"),
  colour: text("colour"),
  /** Rajdanga Fabric # — unique, used like a SKU; required before rolls can be registered */
  fabricNo: text("fabric_no").unique(), // 55, 55A, 55B
  unit: text("unit").notNull().default("kg"),
  vendor: text("vendor"),
  /** Colour swatch for the rack map, e.g. #24304f */
  hex: text("hex"),
  active: boolean("active").notNull().default(true),
  createdAt: now("created_at"),
}, (t) => [index("fabric_cw_idx").on(t.cwFabricCode, t.colour)]);

/** Tab 10 — Users */
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: roleEnum("role").notNull().default("VIEWER"),
  active: boolean("active").notNull().default(true),
  allLocations: boolean("all_locations").notNull().default(false),
  allStylePOs: boolean("all_style_pos").notNull().default(false),
  /** Style PO prefixes this person may post against, comma separated (CT26/PO/8 allows CT26/PO/80, /88 …) */
  stylePOPrefixes: text("style_po_prefixes"),
  createdAt: now("created_at"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const userLocations = pgTable("user_locations", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.userId, t.locationId] })]);

// ---------- Rolls ----------

/** B-<fabric PO without symbols>-<Fabric #>-<nn>, counting up per PO and fabric (one per receipt unless an existing batch is given) */
export const batches = pgTable("batches", {
  id: id(),
  code: text("code").notNull().unique(),
  fabricItemId: text("fabric_item_id").notNull().references(() => fabricItems.id),
  fabricPO: text("fabric_po").notNull(),
  seq: integer("seq").notNull(),
  createdAt: now("created_at"),
});

/** Tab 7 — Rolls. current location / consumed / adjusted / remaining are written by the
 * posting code in the same DB transaction as the ledger line, and re-checked against the
 * ledger by the daily health check. */
export const rolls = pgTable("rolls", {
  id: id(),
  serial: text("serial").notNull().unique(),
  batchId: text("batch_id").notNull().references(() => batches.id),
  fabricItemId: text("fabric_item_id").notNull().references(() => fabricItems.id),
  fabricPO: text("fabric_po").notNull(),
  registeredDate: date("registered_date").notNull(),
  registeredLocationId: text("registered_location_id").notNull().references(() => locations.id),
  weighedG: integer("weighed_g").notNull(),
  /** name typed on the receive form (or "Cut from <serial>") */
  weighedBy: text("weighed_by").notNull(),
  registeredBy: text("registered_by"),
  challan: text("challan"),
  notes: text("notes"),
  /** cut pieces: the roll this piece was cut from */
  splitFromId: text("split_from_id"),
  /** kg cut off this roll into pieces */
  splitG: integer("split_g").notNull().default(0),
  lastMovement: text("last_movement"),
  labelPrintedAt: timestamp("label_printed_at", { withTimezone: true }),
  labelPrintedBy: text("label_printed_by"),
  labelActivatedAt: timestamp("label_activated_at", { withTimezone: true }),
  currentLocationId: text("current_location_id").notNull().references(() => locations.id),
  consumedG: integer("consumed_g").notNull().default(0),
  adjustedG: integer("adjusted_g").notNull().default(0),
  remainingG: integer("remaining_g").notNull(),
  status: rollStatusEnum("status").notNull().default("AWAITING_LABEL"),
  // --- warehouse (rack) layer: only meaningful while the roll is at a location that has racks
  rackId: text("rack_id"),
  rackSince: timestamp("rack_since", { withTimezone: true }),
  /** Rack it last left from — put away offers to put it back there */
  lastRackId: text("last_rack_id"),
  /** why it's off a rack: NEW | ARRIVED | RETURNED | MOVED_OUT */
  offRackReason: text("off_rack_reason"),
  offRackRef: text("off_rack_ref"),
  offRackAt: timestamp("off_rack_at", { withTimezone: true }),
  /** set when a rack count doesn't find it; cleared by the next scan in the warehouse */
  missingSince: timestamp("missing_since", { withTimezone: true }),
  createdAt: now("created_at"),
}, (t) => [index("roll_rack_idx").on(t.rackId), index("roll_loc_idx").on(t.currentLocationId, t.status), index("roll_fabric_idx").on(t.fabricItemId), index("roll_batch_idx").on(t.batchId), index("roll_created_idx").on(t.createdAt)]);

// ---------- Postings ----------

/** Tabs 2 & 3 header. A posted TO is final; a mistake is fixed by a reversal TO. */
export const transferOrders = pgTable("transfer_orders", {
  id: id(),
  toNumber: text("to_number").notNull().unique(),
  type: toTypeEnum("type").notNull(),
  date: date("date").notNull(),
  reason: text("reason"),
  sourceLocationId: text("source_location_id").notNull().references(() => locations.id),
  destLocationId: text("dest_location_id").notNull().references(() => locations.id),
  destAddress: text("dest_address"),
  stylePO: text("style_po"),
  moNumber: text("mo_number"),
  taxInvoiceNo: text("tax_invoice_no"),
  attachmentsUrl: text("attachments_url"),
  /** total pieces over all item rows */
  piecesMade: integer("pieces_made"),
  postedBy: text("posted_by").notNull(),
  postedAt: now("posted_at"),
  enteredInZoho: boolean("entered_in_zoho").notNull().default(false),
  enteredInZohoAt: timestamp("entered_in_zoho_at", { withTimezone: true }),
  enteredInZohoBy: text("entered_in_zoho_by"),
  isReversal: boolean("is_reversal").notNull().default(false),
  /** a reversal has its own next number and points at the TO it reverses */
  reversalOfId: text("reversal_of_id").unique(),
  reversalReason: text("reversal_reason"),
}, (t) => [index("to_date_idx").on(t.date), index("to_style_idx").on(t.stylePO), index("to_posted_idx").on(t.postedAt)]);

/** The item rows as typed on the Zoho-style form (Fabric # or SKU + kg, pieces per row) */
export const toItems = pgTable("to_items", {
  id: id(),
  toId: text("to_id").notNull().references(() => transferOrders.id),
  rowNo: integer("row_no").notNull(),
  fabricItemId: text("fabric_item_id").notNull().references(() => fabricItems.id),
  kgG: integer("kg_g").notNull(),
  wasteG: integer("waste_g").notNull().default(0),
  pieces: integer("pieces"),
  /** FIFO = oldest rolls first (default) · SCAN = exact rolls scanned */
  pick: text("pick").notNull().default("FIFO"),
}, (t) => [uniqueIndex("toitem_uq").on(t.toId, t.rowNo)]);

/** Tab 5 — TO Log: one row per roll per TO */
export const toLines = pgTable("to_lines", {
  id: id(),
  toId: text("to_id").notNull().references(() => transferOrders.id),
  rollId: text("roll_id").notNull().references(() => rolls.id),
  batchCode: text("batch_code").notNull(),
  fabricNo: text("fabric_no").notNull(),
  /** transfer qty, or kg used on the style PO (negative on reversals) */
  kgG: integer("kg_g").notNull(),
  wasteG: integer("waste_g").notNull().default(0),
  sourceBeforeG: integer("source_before_g").notNull(),
  sourceAfterG: integer("source_after_g").notNull(),
  destBeforeG: integer("dest_before_g").notNull(),
  destAfterG: integer("dest_after_g").notNull(),
  rollBeforeG: integer("roll_before_g").notNull(),
  rollAfterG: integer("roll_after_g").notNull(),
  itemRow: integer("item_row").notNull().default(1),
  /** this line moved a piece cut from another roll */
  cutFromSerial: text("cut_from_serial"),
  /** rack the roll was on when the TO was posted (pick list) */
  rackCode: text("rack_code"),
}, (t) => [uniqueIndex("toline_uq").on(t.toId, t.rollId), index("toline_roll_idx").on(t.rollId)]);

/** Tab 6 — Order Links: one row per piece */
export const orderLinks = pgTable("order_links", {
  id: id(),
  toId: text("to_id").notNull().references(() => transferOrders.id),
  pieceIndex: integer("piece_index").notNull(),
  rollSerials: text("roll_serials").notNull(),
  stylePO: text("style_po").notNull(),
  orderNumber: text("order_number").notNull(),
  itemRow: integer("item_row").notNull().default(1),
  fabricNo: text("fabric_no"),
  colour: text("colour"),
  kgPerPieceG: integer("kg_per_piece_g"),
  reversed: boolean("reversed").notNull().default(false),
}, (t) => [index("order_no_idx").on(t.orderNumber), index("order_to_idx").on(t.toId)]);

/** Tab 4 — Adjustments. Only APPROVED ones change the roll. */
export const adjustments = pgTable("adjustments", {
  id: id(),
  number: text("number").notNull().unique(),
  rollId: text("roll_id").notNull().references(() => rolls.id),
  kgChangeG: integer("kg_change_g").notNull(),
  reason: adjReasonEnum("reason").notNull(),
  note: text("note"),
  photoUrl: text("photo_url"),
  status: adjStatusEnum("status").notNull(),
  requestedBy: text("requested_by").notNull(),
  requestedAt: now("requested_at"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  rollBeforeG: integer("roll_before_g"),
  rollAfterG: integer("roll_after_g"),
  reversalOfId: text("reversal_of_id"),
}, (t) => [index("adj_status_idx").on(t.status), index("adj_roll_idx").on(t.rollId)]);

// ---------- Support ----------

/** Scans are saved per person as they happen — closing the page or losing Wi-Fi loses nothing. */
export const drafts = pgTable("drafts", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  data: jsonb("data").notNull(),
  updatedAt: now("updated_at"),
}, (t) => [uniqueIndex("draft_uq").on(t.userId, t.kind)]);

/** Tab 12 — Audit */
export const audit = pgTable("audit", {
  id: id(),
  at: now("at"),
  userEmail: text("user_email").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  rollSerials: text("roll_serials"),
  kgBeforeG: integer("kg_before_g"),
  kgAfterG: integer("kg_after_g"),
  details: jsonb("details"),
}, (t) => [index("audit_at_idx").on(t.at), index("audit_entity_idx").on(t.entity, t.entityId)]);

/** Tab 11 — Carbonwork Check history */
export const checks = pgTable("carbonwork_checks", {
  id: id(),
  fileDate: date("file_date").notNull(),
  fileName: text("file_name").notNull(),
  ledgerName: text("ledger_name"),
  createdAt: now("created_at"),
  createdBy: text("created_by").notNull(),
  status: text("status").notNull().default("OPEN"),
  rowsChecked: integer("rows_checked").notNull(),
  rowsFlagged: integer("rows_flagged").notNull(),
  kgGapG: integer("kg_gap_g").notNull(),
  rollsWeighed: integer("rolls_weighed").notNull().default(0),
  notes: text("notes"),
  results: jsonb("results").notNull(),
  toMatch: jsonb("to_match"),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const spotWeighs = pgTable("spot_weighs", {
  id: id(),
  checkId: text("check_id").notNull().references(() => checks.id),
  rollId: text("roll_id").notNull().references(() => rolls.id),
  sheetG: integer("sheet_g").notNull(),
  weighedG: integer("weighed_g"),
  weighedAt: timestamp("weighed_at", { withTimezone: true }),
  weighedBy: text("weighed_by"),
}, (t) => [uniqueIndex("spot_uq").on(t.checkId, t.rollId)]);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const backups = pgTable("backups", {
  id: id(),
  createdAt: now("created_at"),
  sizeBytes: integer("size_bytes").notNull(),
  data: bytea("data").notNull(),
});

export const healthReports = pgTable("health_reports", {
  id: id(),
  createdAt: now("created_at"),
  issues: jsonb("issues").notNull(),
});

export const counters = pgTable("counters", {
  name: text("name").primaryKey(),
  value: integer("value").notNull(),
});

// ---------- Warehouse (racks) ----------

/** Racks inside a location (e.g. Rajdanga Storage). Label: RK-<code> */
export const racks = pgTable("racks", {
  id: id(),
  code: text("code").notNull().unique(),
  locationId: text("location_id").notNull().references(() => locations.id),
  room: text("room").notNull(),
  building: text("building").notNull(),
  capacity: integer("capacity").notNull().default(48),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  lastCountedAt: timestamp("last_counted_at", { withTimezone: true }),
  lastCountGaps: integer("last_count_gaps"),
  createdAt: now("created_at"),
});

/** Movement log: every change of rack, and every TO that takes a roll on/off the warehouse */
export const rackMoves = pgTable("rack_moves", {
  id: id(),
  at: now("at"),
  rollId: text("roll_id").notNull().references(() => rolls.id),
  serial: text("serial").notNull(),
  fromLabel: text("from_label").notNull(),
  toLabel: text("to_label").notNull(),
  /** SCAN | TO | COUNT | ADJ */
  via: text("via").notNull(),
  ref: text("ref"),
  by: text("by").notNull(),
  note: text("note"),
}, (t) => [index("rackmove_at_idx").on(t.at), index("rackmove_roll_idx").on(t.rollId)]);

export const rackCounts = pgTable("rack_counts", {
  id: id(),
  rackId: text("rack_id").notNull().references(() => racks.id),
  startedAt: now("started_at"),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  by: text("by").notNull(),
  expected: integer("expected").notNull().default(0),
  found: integer("found").notNull().default(0),
  gaps: integer("gaps").notNull().default(0),
  note: text("note"),
  /** { found: serial[], missing: serial[], fixed: serial[] } */
  details: jsonb("details"),
});

/** Every serial ever issued — kept even if a roll row is ever removed, so a serial is never reused */
export const serialRegistry = pgTable("serial_registry", {
  serial: text("serial").primaryKey(),
  issuedAt: now("issued_at"),
  fabricNo: text("fabric_no"),
  how: text("how"),
});
