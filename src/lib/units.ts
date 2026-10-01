/** kg (number or string) -> integer grams. Returns NaN for invalid input. */
export function toG(kg: number | string | null | undefined): number {
  if (kg === null || kg === undefined || kg === "") return NaN;
  const n = typeof kg === "number" ? kg : Number(String(kg).replace(",", ".").trim());
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 1000);
}
export const toKg = (g: number | null | undefined) => (g ?? 0) / 1000;
export function fmtKg(g: number | null | undefined, digits = 2) {
  return toKg(g).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits === 1 ? 1 : 3 });
}
/** Today's date in India (YYYY-MM-DD) */
export function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
export function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "";
  return new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
}
export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "";
  const s = typeof d === "string" ? d : d.toISOString();
  const [y, m, day] = s.slice(0, 10).split("-");
  return `${day}-${m}-${y}`;
}
export function kgClass(g: number) {
  if (g < 0) return "text-red-600 font-semibold";
  if (g < 20000) return "text-amber-600";
  return "";
}
