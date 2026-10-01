"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ZohoTick, ReverseAdjButton } from "@/components/Buttons";

/**
 * Interactive table for the Stock & History pages.
 * Search across every column · click a header to sort · filter by column values · pick columns ·
 * page through big lists · totals for kg columns · CSV of exactly what you see · click a row to open it.
 */
export type Kind = "text" | "mono" | "num" | "kg" | "kg1" | "kg3" | "signedkg" | "date" | "datetime" | "pill" | "zoho" | "reverseAdj" | "links";
export type Col = {
  key: string; label: string; kind?: Kind;
  href?: string;          // row key holding a link for this cell
  sub?: string;           // row key with a small second line
  tone?: string;          // row key with a pill tone: ok | warn | bad | muted | info
  filter?: boolean;       // offer a "pick values" filter for this column
  hidden?: boolean;       // hidden until switched on in Columns
  total?: boolean;        // show a total of the filtered rows
  wide?: boolean;         // allow wrapping
};
export type Row = Record<string, unknown> & { _id: string; _href?: string; _muted?: boolean; _strike?: boolean; _disabled?: boolean };

const kgFmt = (g: unknown, d = 2) => (typeof g === "number" ? (g / 1000).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d === 1 ? 1 : 3 }) : "");
const dFmt = (v: unknown) => { if (!v) return ""; const s = v instanceof Date ? v.toISOString() : String(v); const [y, m, d] = s.slice(0, 10).split("-"); return `${d}-${m}-${y}`; };
const dtFmt = (v: unknown) => (v ? new Date(String(v)).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "");
const NUMERIC: Kind[] = ["num", "kg", "kg1", "kg3", "signedkg"];

function text(c: Col, v: unknown): string {
  switch (c.kind) {
    case "kg": case "signedkg": return v === null || v === undefined ? "" : (c.kind === "signedkg" && (v as number) > 0 ? "+" : "") + kgFmt(v);
    case "kg1": return kgFmt(v, 1);
    case "kg3": return kgFmt(v, 3);
    case "date": return dFmt(v);
    case "datetime": return dtFmt(v);
    case "zoho": return v ? "yes" : "no";
    case "links": return Array.isArray(v) ? (v as { t: string }[]).map((x) => x.t).join(", ") : "";
    case "reverseAdj": return "";
    default: return v === null || v === undefined ? "" : String(v);
  }
}

function Hi({ s, q }: { s: string; q: string }) {
  if (!q || !s) return <>{s}</>;
  const i = s.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{s}</>;
  return <>{s.slice(0, i)}<mark className="bg-[oklch(0.92_0.1_95)] text-ink rounded-sm px-px">{s.slice(i, i + q.length)}</mark>{s.slice(i + q.length)}</>;
}

const TONE: Record<string, string> = { ok: "bg-okbg text-[oklch(0.42_0.1_150)]", warn: "bg-warnbg text-[oklch(0.45_0.1_70)]", bad: "bg-badbg text-bad", muted: "bg-chip text-muted", info: "bg-[#eaf1fb] text-[#2459a8]" };

export function DataTable({ id, cols, rows, csvName, initialSort, empty = "Nothing here yet", pageSize = 100, toolbar, initialQuery }: {
  id: string; cols: Col[]; rows: Row[]; csvName: string; initialSort?: { key: string; dir: "asc" | "desc" }; empty?: string; pageSize?: number;
  toolbar?: React.ReactNode; initialQuery?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery ?? "");
  const dq = useDeferredValue(q.trim());
  const [sort, setSort] = useState(initialSort ?? null);
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(cols.filter((c) => c.hidden).map((c) => c.key)));
  const [showCols, setShowCols] = useState(false);
  const [size, setSize] = useState(pageSize);
  const [page, setPage] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // remember the column choice per table
  useEffect(() => { try { const s = localStorage.getItem(`tbl-cols-${id}`); if (s) setHidden(new Set(JSON.parse(s))); } catch {} }, [id]);
  const saveHidden = (h: Set<string>) => { setHidden(h); try { localStorage.setItem(`tbl-cols-${id}`, JSON.stringify([...h])); } catch {} };
  // "/" jumps to the table search (unless typing somewhere)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !e.metaKey && !e.ctrlKey) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);
  useEffect(() => setPage(0), [dq, filters, sort, size]);

  const visible = cols.filter((c) => !hidden.has(c.key));
  const filterCols = cols.filter((c) => c.filter);
  const options = useMemo(() => Object.fromEntries(filterCols.map((c) => {
    const m = new Map<string, number>();
    for (const r of rows) { const t = text(c, r[c.key]) || "(blank)"; m.set(t, (m.get(t) ?? 0) + 1); }
    return [c.key, [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))];
  })), [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const ql = dq.toLowerCase();
    let out = rows.filter((r) => {
      for (const [k, vals] of Object.entries(filters)) {
        if (!vals.length) continue;
        const c = cols.find((x) => x.key === k)!;
        if (!vals.includes(text(c, r[k]) || "(blank)")) return false;
      }
      if (!ql) return true;
      return cols.some((c) => text(c, r[c.key]).toLowerCase().includes(ql) || (c.sub && String(r[c.sub] ?? "").toLowerCase().includes(ql)));
    });
    if (sort) {
      const c = cols.find((x) => x.key === sort.key);
      const num = c && NUMERIC.includes(c.kind ?? "text");
      const dir = sort.dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const x = a[sort.key], y = b[sort.key];
        if (x === y) return 0;
        if (x === null || x === undefined || x === "") return 1;
        if (y === null || y === undefined || y === "") return -1;
        if (num) return ((x as number) - (y as number)) * dir;
        if (c?.kind === "date" || c?.kind === "datetime") return (new Date(x as string).getTime() - new Date(y as string).getTime()) * dir;
        return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir;
      });
    }
    return out;
  }, [rows, dq, filters, sort, cols]);

  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const shown = filtered.slice(page * size, page * size + size);
  const totals = visible.filter((c) => c.total).map((c) => [c.key, filtered.reduce((a, r) => a + (Number(r[c.key]) || 0), 0)] as const);
  const activeFilters = Object.entries(filters).filter(([, v]) => v.length);

  const clickSort = (k: string) => setSort((s) => (!s || s.key !== k ? { key: k, dir: "asc" } : s.dir === "asc" ? { key: k, dir: "desc" } : null));
  const csv = () => {
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [visible.filter((c) => c.kind !== "reverseAdj").map((c) => esc(c.label)).join(",")];
    for (const r of filtered) lines.push(visible.filter((c) => c.kind !== "reverseAdj").map((c) => esc(NUMERIC.includes(c.kind ?? "text") && typeof r[c.key] === "number" ? String((r[c.key] as number) / (c.kind === "num" ? 1 : 1000)) : text(c, r[c.key]))).join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv" }));
    a.download = `${csvName}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };

  const cell = (c: Col, r: Row) => {
    const v = r[c.key];
    const t = text(c, v);
    const href = c.href ? (r[c.href] as string | undefined) : undefined;
    let body: React.ReactNode = <Hi s={t} q={dq} />;
    if (c.kind === "pill" && t) body = <span className={`pill font-medium ${TONE[(c.tone && (r[c.tone] as string)) || "muted"]}`}>{t}</span>;
    if (c.kind === "zoho") body = <ZohoTick id={String(r._toId ?? r._id)} value={!!v} disabled={!!r._disabled} />;
    if (c.kind === "reverseAdj") body = v ? <ReverseAdjButton id={String(v)} /> : null;
    if (c.kind === "links") body = (v as { t: string; h: string }[] | undefined)?.map((x) => <Link key={x.t} href={x.h} className="underline decoration-line underline-offset-2 mr-2 hover:decoration-ink"><Hi s={x.t} q={dq} /></Link>);
    if (href) body = <Link href={href} className="font-medium underline-offset-2 hover:underline">{body}</Link>;
    const neg = (c.kind === "signedkg" || c.kind === "kg") && typeof v === "number" && v < 0;
    const pos = c.kind === "signedkg" && typeof v === "number" && v > 0;
    return (
      <td key={c.key} className={`${NUMERIC.includes(c.kind ?? "text") ? "text-right tabular-nums" : ""} ${c.kind === "mono" || c.kind === "links" ? "mono text-[12.5px]" : ""} ${c.wide ? "max-w-[360px]" : "whitespace-nowrap"} ${neg ? "text-bad font-semibold" : pos ? "text-ok font-semibold" : ""}`}>
        {body}
        {c.sub && r[c.sub] ? <div className="text-[11px] text-muted font-normal">{String(r[c.sub])}</div> : null}
      </td>
    );
  };

  return (
    <div className="card flex flex-col min-w-0">
      {/* toolbar */}
      <div className="flex items-center gap-2 flex-wrap p-3 border-b border-line">
        <div className="flex items-center gap-2 h-10 px-3 rounded-lg border border-[#d6d2c9] bg-white flex-[1_1_240px] max-w-md focus-within:border-ink">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" className="text-faint shrink-0"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this table…  ( / )" className="flex-1 min-w-0 outline-none text-sm bg-transparent" aria-label="Search this table" />
          {q && <button type="button" onClick={() => setQ("")} className="text-faint hover:text-ink text-sm" aria-label="Clear search">✕</button>}
        </div>
        {filterCols.map((c) => {
          const sel = filters[c.key] ?? [];
          return (
            <div key={c.key} className="relative">
              <button type="button" onClick={() => setOpenFilter(openFilter === c.key ? null : c.key)}
                className={`h-10 px-3 rounded-lg border text-[13px] flex items-center gap-1.5 cursor-pointer ${sel.length ? "border-ink bg-ink text-white" : "border-[#d6d2c9] bg-white hover:bg-[#faf9f6]"}`}>
                {c.label.charAt(0) + c.label.slice(1).toLowerCase()}{sel.length ? `: ${sel.length === 1 ? sel[0] : sel.length}` : ""}
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {openFilter === c.key && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setOpenFilter(null)} />
                  <div className="absolute z-40 top-11 left-0 w-64 max-h-80 overflow-y-auto card shadow-lg p-1.5">
                    {options[c.key]?.map(([val, n]) => (
                      <label key={val} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-chip text-[13px] cursor-pointer">
                        <input type="checkbox" checked={sel.includes(val)} onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.checked ? [...sel, val] : sel.filter((x) => x !== val) }))} />
                        <span className="truncate flex-1">{val}</span><span className="mono text-[11px] text-faint">{n}</span>
                      </label>
                    ))}
                    {sel.length > 0 && <button type="button" className="w-full text-left px-2 py-1.5 text-xs text-muted hover:text-ink" onClick={() => setFilters((f) => ({ ...f, [c.key]: [] }))}>Clear</button>}
                  </div>
                </>
              )}
            </div>
          );
        })}
        {toolbar ? <span className="contents">{toolbar}</span> : null}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <button type="button" className="btn-ghost h-10 px-3 text-[13px]" onClick={() => setShowCols(!showCols)}>Columns</button>
            {showCols && (<>
              <div className="fixed inset-0 z-30" onClick={() => setShowCols(false)} />
              <div className="absolute z-40 right-0 top-11 w-56 max-h-96 overflow-y-auto card shadow-lg p-1.5">
                {cols.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-chip text-[13px] cursor-pointer">
                    <input type="checkbox" checked={!hidden.has(c.key)} onChange={(e) => { const h = new Set(hidden); if (e.target.checked) h.delete(c.key); else h.add(c.key); saveHidden(h); }} />{c.label || "(actions)"}
                  </label>))}
              </div></>)}
          </div>
          <button type="button" className="btn-ghost h-10 px-3 text-[13px]" onClick={csv} title="Download exactly the rows you see">CSV</button>
        </div>
      </div>

      {/* summary line */}
      <div className="flex items-center gap-3 flex-wrap px-3 py-2 text-[12.5px] text-muted border-b border-line2 bg-[#fcfbf9]">
        <span><b className="text-ink">{filtered.length.toLocaleString("en-IN")}</b> of {rows.length.toLocaleString("en-IN")} rows</span>
        {totals.map(([k, sum]) => { const c = cols.find((x) => x.key === k)!; return <span key={k}>· {c.label.toLowerCase()} <b className="text-ink">{c.kind === "num" ? sum.toLocaleString("en-IN") : kgFmt(sum, 1)}{c.kind === "num" ? "" : " kg"}</b></span>; })}
        {(activeFilters.length > 0 || dq) && <button type="button" className="underline hover:text-ink" onClick={() => { setFilters({}); setQ(""); }}>Clear all filters</button>}
        {sort && <span>· sorted by {cols.find((c) => c.key === sort.key)?.label.toLowerCase()} {sort.dir === "asc" ? "↑" : "↓"}</span>}
      </div>

      <div className="overflow-auto max-h-[calc(100dvh-260px)] min-h-[200px]">
        <table className="tbl">
          <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_var(--color-line)]">
            <tr>{visible.map((c) => {
              const on = sort?.key === c.key;
              const sortable = !["zoho", "reverseAdj", "links"].includes(c.kind ?? "");
              return (
                <th key={c.key} className={`${NUMERIC.includes(c.kind ?? "text") ? "text-right" : ""} ${sortable ? "cursor-pointer select-none hover:text-ink" : ""} ${on ? "text-ink" : ""}`}
                  onClick={sortable ? () => clickSort(c.key) : undefined} aria-sort={on ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}>
                  {c.label}<span className={`ml-1 ${on ? "" : "opacity-0"}`}>{on && sort!.dir === "desc" ? "↓" : "↑"}</span>
                </th>);
            })}</tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r._id} className={`${r._href ? "cursor-pointer" : ""} ${r._muted ? "text-muted" : ""} ${r._strike ? "line-through text-faint" : ""}`}
                onClick={(e) => { if (!r._href) return; const t = e.target as HTMLElement; if (t.closest("a,button,input,label")) return; if (window.getSelection()?.toString()) return; router.push(r._href); }}>
                {visible.map((c) => cell(c, r))}
              </tr>))}
            {!shown.length && <tr><td colSpan={visible.length} className="text-center text-muted py-10">{rows.length ? "No rows match. Try clearing a filter." : empty}</td></tr>}
          </tbody>
        </table>
      </div>

      {/* pager */}
      {filtered.length > 25 && (
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-t border-line text-[12.5px] text-muted">
          <span>Rows per page</span>
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="h-8 px-2 rounded-md border border-line bg-white text-ink">
            {[25, 50, 100, 250, 1000].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="ml-auto">{page * size + 1}–{Math.min(filtered.length, (page + 1) * size)} of {filtered.length.toLocaleString("en-IN")}</span>
          <button type="button" className="btn-ghost btn-sm" disabled={page === 0} onClick={() => setPage(0)} aria-label="First page">«</button>
          <button type="button" className="btn-ghost btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</button>
          <span className="mono">{page + 1}/{pages}</span>
          <button type="button" className="btn-ghost btn-sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
          <button type="button" className="btn-ghost btn-sm" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)} aria-label="Last page">»</button>
        </div>
      )}
    </div>
  );
}
