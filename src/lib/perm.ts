/** Pure permission helpers (no framework imports) — used by the posting engine. */
export type Role = "ADMIN" | "INVENTORY" | "MERCHANDISER" | "VIEWER";
export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  allLocations: boolean;
  allStylePOs: boolean;
  locationIds: string[];
  stylePOCodes: string[];
};
export const canPostLocation = (u: CurrentUser, locationId: string) => u.allLocations || u.locationIds.includes(locationId);
/** Style POs are prefixes: CT26/PO/8 allows CT26/PO/8, /80, /88 … */
export const canUseStylePO = (u: CurrentUser, code: string) =>
  u.role === "ADMIN" || u.allStylePOs || u.stylePOCodes.some((p) => code.toUpperCase().startsWith(p.toUpperCase()));
