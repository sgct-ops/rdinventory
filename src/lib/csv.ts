import Papa from "papaparse";

export function parseCsv(text: string): Record<string, string>[] {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true, skipEmptyLines: true, transformHeader: (h) => h.trim(),
  });
  return res.data;
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Find the first header matching any alias (case/space/underscore-insensitive). */
export function pick(headers: string[], aliases: string[]): string | undefined {
  const map = new Map(headers.map((h) => [norm(h), h]));
  for (const a of aliases) { const h = map.get(norm(a)); if (h) return h; }
  return undefined;
}
/** Neutralise spreadsheet formulas in text cells (CSV injection) — numbers are left alone. */
const safe = (v: unknown) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);
export function toCsv(rows: Record<string, unknown>[]): string {
  return Papa.unparse(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safe(v)]))));
}
