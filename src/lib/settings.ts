import { db, schema } from "@/db";

export const DEFAULT_SETTINGS = {
  adjLimitKg: "2",
  adjLimitPct: "5",
  /** SMALLER = needs approval above the smaller of the two; LARGER = above the larger */
  adjLimitRule: "SMALLER",
  labelWidthMm: "75",
  labelHeightMm: "50",
  orderNumberPattern: "^(#?[A-Za-z0-9-]{3,30}|STOCK)$",
  checkTolKg: "2",
  checkTolPct: "1",
  undoMinutes: "10",
  lowStockKg: "20",
  rackFullPct: "90",
  spotCheckRolls: "5",
  /** JSON: your notes per field on the Formats page */
  formatNotes: "{}",
  /** receiving more than this % above a PO line's expected kg needs a confirmation */
  poOverPct: "10",
  /** put in front of every new SKU the fabric repository makes (e.g. "FAB-") */
  skuPrefix: "",
  /** the bell flags rolls taken out for production longer than this */
  takeOutAlertDays: "3",
};
export type Settings = typeof DEFAULT_SETTINGS;

export async function getSettings(): Promise<Settings> {
  const rows = await db.select().from(schema.settings);
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in s) (s as Record<string, string>)[r.key] = r.value;
  return s;
}
