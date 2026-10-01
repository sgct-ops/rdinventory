/** Input formats and fixed lists — the same rules as the Google Sheet (see the Formats page). Safe for browser and server. */
export const FMT = {
  stylePO: /^(CT\w*\/PO\/[\w-]+|PO-[\w-]+)$/i, // CT26/PO/88 or PO-112
  fabricPO: /^([A-Z]{2,4}\d*\/PO\/[\w-]+|PO-[\w-]+)$/i, // CT26/PO/48, CTF/PO/136 or PO-112
  fabricNo: /^\d+[A-Z]*$/i, // 55, 55A, 55B
  toNumber: /^TRO[RC]-\d{3,}$/i,
};
export const TO_PREFIX = { TRANSFER: "TROR-", CONSUMPTION: "TROC-" } as const;
export const pad3 = (n: number) => (n < 1000 ? String(n).padStart(3, "0") : String(n));
export const MAX_ROLL_KG = 80;

export const REASONS = {
  REWEIGHED: "Re-weighed",
  DAMAGED: "Damaged",
  WASTAGE_NOT_ON_TO: "Wastage not on a TO",
  FOUND: "Found",
  LOST: "Lost",
  SPOT_CHECK_CORRECTION: "Spot-check correction",
  OPENING_STOCK_CORRECTION: "Opening-stock correction",
  OTHER: "Other",
} as const;
export type AdjReason = keyof typeof REASONS;

export const LOCATION_TYPES = ["STORAGE", "PRODUCTION", "FACTORY", "VENDOR", "OFFICE"] as const;
export const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** field, where you type it, rule now, example, set by */
export const FORMATS: [string, string, string, string, string][] = [
  ["Transfer Order #", "Automatic (order forms)", "TROR- (transfer) or TROC- (consumption) + 3 digits. One shared series, so a number is never used twice. A reversal takes the next number.", "TROR-001, TROC-002, TROR-003", "App"],
  ["Date", "Order forms", "Pick from the calendar. Today or earlier (no future dates).", "29 Sep 2026", "You"],
  ["Style PO", "Consumption order", "CT…/PO/number, or PO- and the number. Upper case is added for you.", "CT26/PO/88, PO-112", "You"],
  ["Fabric PO", "Receive fabric PO", "2–4 letters, optional digits, /PO/ and the number; or PO- and the number.", "CT26/PO/48, CTF/PO/136, PO-112", "You"],
  ["Rajdanga Fabric #", "Fabric Inventory", "A number, optionally with letters after it for colours of the same fabric. Unique. Starts every roll serial.", "55, 55A, 55B", "You"],
  ["SKU", "Fabric Inventory (from Zoho)", "Exactly as in Zoho. Unique. Matched ignoring case in the forms and the dashboard finder.", "FAB-8D2-PIN", "You / Zoho"],
  ["Item (order forms)", "Order forms, Items", "Type the Rajdanga Fabric # or the SKU (either works, any case). Picks from the list as you type.", "55A or fab-8d2-pin", "You"],
  ["Carbonwork Fabric", "Fabric Inventory", "The fabric code used in Carbonwork.", "8D2, 3D2, 12", "You"],
  ["Colour", "Fabric Inventory", "Colour name as in Carbonwork, so the spot check can match.", "Pine Green", "You"],
  ["Fabric Group", "Fabric Inventory (Zoho Group)", "The Zoho item group. Used by the dashboard finder. If empty, the Carbonwork fabric code is used.", "Fabric 8D2", "You / Zoho"],
  ["Zoho Item ID / Zoho Item Name", "Fabric Inventory", "Copied from Zoho. Used in the Zoho prompt to find the item.", "2400000001234 / Fabric 8D2-Pine Green", "Zoho"],
  ["Roll serial", "Automatic (receiving, cut pieces)", "Rajdanga Fabric # + - + 4 random digits. Never issued twice, ever: every serial is kept in the serial registry. Printed on the label as a barcode.", "55A-4821", "App"],
  ["Batch", "Automatic (receiving)", "B- + Fabric PO without symbols + - + Fabric # + - + 2 digits, counting up per PO and fabric. Leave empty; type an existing batch only to add more rolls to it.", "B-CT26PO48-55A-01", "App"],
  ["Roll weight", "Receive fabric PO", "kg, up to 2 decimals. Above 0 and at most 80 kg per roll.", "24.6", "You"],
  ["Transfer quantity", "Transfer order", "kg, up to 2 decimals, above 0. Whole rolls move first (oldest first); if the kg ends inside a roll it is cut and the piece gets a new serial and label. Or scan the exact rolls.", "45", "You"],
  ["Kg used / Waste kg", "Consumption order", "kg, up to 2 decimals. Kg used above 0; waste 0 or more. Taken from the roll scanned on that row (it must be taken out for production first).", "21.8 / 1.3", "You"],
  ["Pieces", "Consumption order, per item row", "Whole number, optional. When filled, one order number per piece is required.", "6", "You"],
  ["Order number", "Consumption order, under each row", "Free text, one per piece. Repeat it for an order with several pieces. If an earlier TROC already used it for the same fabric, the app asks whether it is a recut and adds _recut (then _recut2 …).", "#CT10252, #CT10252_recut", "You"],
  ["Roll barcode", "Roll labels", "Code 128 of SERIAL|INVOICE|BATCH. Each scan box says which part it wants and keeps only that part. The serial (55A-0042) is still printed large.", "55A-0042|INV-8812|B-55A-260914", "App"],
  ["SKU barcode", "Your pre-printed fabric labels", "The SKU only (fabric group + colour). Used in Fabric/SKU boxes, never as a roll.", "8D2-PIN", "You"],
  ["Invoice #", "Receive fabric", "Required. The vendor's invoice number; it goes on every roll and its barcode.", "RSWM/2526/0881", "You"],
  ["Receipt #", "Automatic (Receive)", "GRN- + date + 4 digits, one per receiving.", "GRN-260930-0004", "App"],
  ["MO number / Tax invoice #", "Order forms", "Free text, optional.", "MO-1142 / INV-204", "You"],
  ["Reason", "Order forms", "Free text, up to 500 characters, optional.", "For CT26/PO/107", "You"],
  ["Source / destination", "Order forms", "Picked from Locations. Transfers go between stock locations. Anything going to a Production location is a consumption order: the fabric becomes cloth and leaves stock.", "Rajdanga Storage → Exim", "You"],
  ["Location Name / Code / Type", "Locations", "Name exactly as in Zoho. Code: short, upper case. Type: Storage, Production, Factory, Vendor or Office.", "Rajdanga Storage / RJS / Storage", "You"],
  ["Carbonwork Name", "Locations", "The location name used in Carbonwork, so the spot check can match it.", "Rajdanga Storage", "You"],
  ["Zoho Location ID", "Locations", "Copied from Zoho. Used in the Zoho prompt.", "4600000012345", "Zoho"],
  ["Adjustment kg", "Adjust a roll", "Plus or minus kg, up to 2 decimals, not 0. A note is needed for “Other” and above the approval limit.", "-0.6", "You"],
  ["Adjustment reason", "Adjust a roll", "One of: " + Object.values(REASONS).join(", ") + ".", "Re-weighed", "You"],
  ["Adj ID", "Automatic", "ADJ- + date (yyMMdd) + - + 4 digits.", "ADJ-260929-0007", "App"],
  ["User email / Role", "Users", "Google login email. Role: Admin, Inventory, Merchandiser or Viewer.", "store@carbontree.com / Inventory", "You"],
  ["User Locations / Style POs", "Users", "Tick locations, or All. Style POs are prefixes: CT26/PO/8 allows CT26/PO/8, /80, /88 …", "CT26/PO/88", "You"],
  ["Rack label", "Racks", "RK- + rack code.", "RK-R2-A", "App"],
  ["TRO numbers (Zoho prompt)", "Zoho prompt", "Comma or space between them. A bare number works (12 = TROR-012 or TROC-012). ALL = every TO not ticked “Entered in Zoho”.", "TROR-004, TROC-005", "You"],
  ["Carbonwork file", "Spot check", "fabric_stock_YYYY-MM-DD.csv from stock-desk\\output\\fabric, with columns fabric, colour, location, here_kg.", "fabric_stock_2026-09-29.csv", "Daily run"],
];
