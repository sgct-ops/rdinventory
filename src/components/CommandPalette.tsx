"use client";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ico, type Icon } from "@/components/icons";
import type { Role } from "@/lib/perm";

/**
 * Ctrl K / ⌘ K / "/" — find anything from anywhere.
 * Pages and actions, fabrics, rolls, racks, transfer orders, customer orders, fabric POs, style POs, batches, locations, adjustments.
 * Arrow keys to move, Enter to open, Ctrl+Enter for a new tab, Tab to switch scope, Esc to close.
 * A preview of the highlighted result shows on the right. Recent picks are remembered on this computer.
 */
export type PaletteAction = { href: string; label: string; icon: Icon; code?: string; hint?: string; section: string };
type Kind = "fabric" | "roll" | "rack" | "to" | "order" | "po" | "style" | "batch" | "location" | "adjustment" | "invoice";
type Hit = { kind: Kind | "page"; id: string; title: string; subtitle?: string; meta?: string; href: string; icon?: Icon;
  badge?: { text: string; tone: "ok" | "warn" | "bad" | "muted" | "info" }; detail?: [string, string][]; exact?: boolean };
type Result = { q: string; scope: string; filters: string[]; groups: { kind: Kind; label: string; hits: Hit[]; more: boolean }[]; exact?: Hit; ms: number };

const SCOPES: { k: "all" | "page" | Kind; label: string; prefix?: string }[] = [
  { k: "all", label: "All" }, { k: "page", label: "Pages" }, { k: "roll", label: "Rolls", prefix: "roll:" }, { k: "fabric", label: "Fabrics", prefix: "fab:" },
  { k: "to", label: "TOs", prefix: "to:" }, { k: "rack", label: "Racks", prefix: "rack:" }, { k: "order", label: "Orders", prefix: "order:" },
  { k: "po", label: "Fabric POs", prefix: "po:" }, { k: "style", label: "Style POs", prefix: "style:" }, { k: "batch", label: "Batches", prefix: "batch:" },
  { k: "invoice", label: "Invoices", prefix: "inv:" }, { k: "location", label: "Locations", prefix: "loc:" },
];
const KIND_ICON: Record<Kind, Icon> = { fabric: "fabric", roll: "roll", rack: "rack", to: "list", order: "hash", po: "doc", style: "scissors", batch: "batch", location: "pin", adjustment: "adjust", invoice: "invoice" };
const TONE: Record<string, string> = { ok: "bg-okbg text-[oklch(0.42_0.1_150)]", warn: "bg-warnbg text-[oklch(0.45_0.1_70)]", bad: "bg-badbg text-bad", muted: "bg-chip text-muted", info: "bg-[#eaf1fb] text-[#2459a8]" };
// words people use for each page
const SYN: Record<string, string> = {
  "/to/transfer": "tror transfer send move out dispatch exim vendor", "/to/consumption": "troc consumption consume use cut production style",
  "/receive": "receive register weigh grn inward po new rolls", "/labels": "print label barcode sticker", "/labels/activate": "activate scan label",
  "/warehouse/put": "put away place rack shelve", "/warehouse/move": "move rack shift", "/warehouse/count": "count stocktake audit rack",
  "/adjustments/new": "adjust correct damage lost found weight", "/adjustments": "approve approval pending", "/check": "carbonwork spot check compare reconcile",
  "/zoho": "zoho prompt claude", "/warehouse": "map racks 3d", "/rolls": "rolls register list stock", "/log": "log tos history tror troc",
  "/orders": "customer order pieces", "/warehouse/log": "movement history", "/warehouse/counts": "counts history", "/audit": "audit who changed",
  "/": "home dashboard kpi overview", "/pos": "incoming purchase orders po zoho carbonwork expected", "/warehouse/takeout": "take out production sampling cutting fifo",
  "/to/pick": "pick dispatch tror warehouse send", "/invoices": "invoice vendor bill", "/admin/fabric-groups": "repository fabric group colour numbering sku rib", "/admin/fabrics": "fabric items masters sku", "/admin/users": "users access roles permissions", "/admin/tools": "demo backup rebuild",
};
const RECENT = "find-recent-v1";
/** the search text without prefixes/filters, the way the server reports it back */
const parseLocal = (raw: string) => raw.replace(/\bkg\s*[<>]=?\s*\d+(?:\.\d+)?/gi, " ").replace(/\bat:("[^"]+"|\S+)/gi, " ").replace(/\bin:(stock|awaiting|finished)\b/gi, " ")
  .replace(/^\s*[a-z]+:\s*/i, "").replace(/\s+/g, " ").trim();
const readRecent = (): Hit[] => { try { return JSON.parse(localStorage.getItem(RECENT) || "[]"); } catch { return []; } };

function score(text: string, q: string) {
  // simple fuzzy: whole-word start > substring > in-order letters
  const t = text.toLowerCase(), s = q.toLowerCase().trim();
  if (!s) return 0;
  if (t.startsWith(s)) return 100;
  if (new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t)) return 80;
  if (t.includes(s)) return 60;
  if (s.length < 3 || /[^a-z ]/.test(s)) return -1;
  let i = 0; for (const ch of t) if (ch === s[i]) i++;
  return i === s.length ? 30 - (t.length - s.length) / 10 : -1;
}

function Hi({ s, q }: { s?: string; q: string }) {
  if (!s) return null;
  const n = q.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (!n) return <>{s}</>;
  // highlight ignoring symbols: map normalised positions back to the text
  const idx: number[] = []; let flat = "";
  for (let i = 0; i < s.length; i++) if (/[a-z0-9]/i.test(s[i])) { idx.push(i); flat += s[i].toLowerCase(); }
  const at = flat.indexOf(n);
  if (at < 0) return <>{s}</>;
  const a = idx[at], b = idx[at + n.length - 1] + 1;
  return <>{s.slice(0, a)}<mark className="bg-[oklch(0.92_0.1_95)] text-ink rounded-sm">{s.slice(a, b)}</mark>{s.slice(b)}</>;
}

export function CommandPalette({ actions, role }: { actions: PaletteAction[]; role: Role }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<(typeof SCOPES)[number]["k"]>("all");
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const [recent, setRecent] = useState<Hit[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, Result>());
  const ctl = useRef<AbortController | null>(null);

  const show = useCallback((preset?: string) => { setOpen(true); setRecent(readRecent()); if (preset !== undefined) setQ(preset); setTimeout(() => input.current?.select(), 10); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); open ? setOpen(false) : show(); }
      else if (!typing && !open && e.key === "/" && !document.querySelector("[aria-label='Search this table']")) { e.preventDefault(); show(); }
    };
    const o = (e: Event) => show((e as CustomEvent).detail?.q);
    window.addEventListener("keydown", k); window.addEventListener("open-find", o);
    return () => { window.removeEventListener("keydown", k); window.removeEventListener("open-find", o); };
  }, [open, show]);

  // pages that match
  const pages: Hit[] = useMemo(() => {
    if (scope !== "all" && scope !== "page") return [];
    const s = q.trim();
    const all = actions.map((a) => ({ a, sc: s ? Math.max(score(a.label, s), score(a.code ?? "", s), score(SYN[a.href] ?? "", s) - 10, score(a.section, s) - 20, score(a.hint ?? "", s) - 25) : 0 }));
    return all.filter((x) => (s ? x.sc > 0 : true)).sort((x, y) => y.sc - x.sc).slice(0, s ? (scope === "page" ? 30 : 5) : 0)
      .map(({ a }) => ({ kind: "page", id: a.href, href: a.href, title: a.label, subtitle: a.section.charAt(0) + a.section.slice(1).toLowerCase(), meta: a.code, icon: a.icon, detail: a.hint ? [["What it does", a.hint]] : undefined }));
  }, [q, scope, actions]);

  // data search (debounced, cancels the previous request, caches answers)
  useEffect(() => {
    if (!open) return;
    const s = q.trim();
    if (!s || scope === "page") { setRes(null); setLoading(false); return; }
    const key = `${scope}|${s}`;
    const hit = cache.current.get(key);
    if (hit) { setRes(hit); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(() => {
      ctl.current?.abort(); const c = new AbortController(); ctl.current = c;
      fetch(`/api/search?q=${encodeURIComponent(s)}&scope=${scope}&per=${scope === "all" ? 5 : 20}`, { signal: c.signal })
        .then((r) => r.json()).then((d: Result) => { cache.current.set(key, d); setRes(d); setLoading(false); })
        .catch((e) => { if (e.name !== "AbortError") setLoading(false); });
    }, 110);
    return () => clearTimeout(t);
  }, [q, scope, open]);

  const empty = !q.trim();
  const sections: { label: string; hits: Hit[]; more?: { kind: Kind } }[] = empty
    ? [...(recent.length ? [{ label: "Recent", hits: recent.slice(0, 6) }] : []),
       { label: "Go to", hits: actions.slice(0, 8).map((a) => ({ kind: "page" as const, id: a.href, href: a.href, title: a.label, subtitle: a.section.charAt(0) + a.section.slice(1).toLowerCase(), meta: a.code, icon: a.icon })) }]
    : [...(res?.exact ? [{ label: "Exact match", hits: [res.exact] }] : []),
       ...(pages.length ? [{ label: "Pages", hits: pages }] : []),
       ...(res?.groups ?? []).map((g) => ({ label: g.label, hits: g.hits.filter((h) => !(res?.exact && h.id === res.exact.id && h.kind === res.exact.kind)), more: g.more ? { kind: g.kind } : undefined })).filter((g) => g.hits.length)];
  const flat = sections.flatMap((s) => s.hits);
  useEffect(() => setSel(0), [q, scope, res]);
  const cur = flat[Math.min(sel, flat.length - 1)];

  const go = (h: Hit, newTab = false) => {
    try { const r = [h, ...readRecent().filter((x) => !(x.id === h.id && x.kind === h.kind))].slice(0, 8); localStorage.setItem(RECENT, JSON.stringify(r.map(({ detail: _d, ...x }) => x))); } catch {}
    setOpen(false); setQ("");
    if (newTab) window.open(h.href, "_blank"); else router.push(h.href);
  };
  const submit = (newTab: boolean) => {
    const s = q.trim();
    // a scanner types fast and presses Enter before results arrive: let the Find page resolve it
    const stale = !!s && scope !== "page" && (loading || !res || res.q !== parseLocal(s));
    if (cur && !stale) return go(cur, newTab);
    if (!s) { if (cur) go(cur, newTab); return; }
    setOpen(false); setQ(""); window.location.assign(`/go?q=${encodeURIComponent(s)}`); // the Find page also jumps straight to an exact serial, rack or TO
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(flat.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); submit(e.ctrlKey || e.metaKey); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "Tab") { e.preventDefault(); const i = SCOPES.findIndex((s) => s.k === scope); setScope(SCOPES[(i + (e.shiftKey ? -1 : 1) + SCOPES.length) % SCOPES.length].k); }
  };
  useEffect(() => { list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);

  if (!open) return null;
  const scopes = SCOPES.filter((s) => !(["to", "order", "style"].includes(s.k) && role === "VIEWER"));
  let n = -1;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-2 sm:p-4 sm:pt-[9vh]" role="dialog" aria-modal="true" aria-label="Find anything">
      <div className="absolute inset-0 bg-[rgb(28_27_25/.45)] backdrop-blur-[2px]" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-[860px] max-h-[calc(100dvh-16px)] sm:max-h-[78vh] bg-white rounded-2xl shadow-2xl border border-line flex flex-col overflow-hidden">
        {/* input */}
        <div className="flex items-center gap-3 px-4 h-14 border-b border-line shrink-0">
          <Ico name="search" size={20} className="text-muted" />
          <input ref={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Search or scan: roll, Fabric #, TO, rack, order #, PO, batch…" aria-label="Find anything"
            className="flex-1 min-w-0 h-full outline-none text-[16px] bg-transparent placeholder:text-faint" spellCheck={false} autoComplete="off" />
          {loading && <span className="w-4 h-4 rounded-full border-2 border-line border-t-ink animate-spin" aria-label="Searching" />}
          {res && !loading && <span className="mono text-[11px] text-faint hidden sm:inline">{res.ms} ms</span>}
          <kbd className="mono text-[11px] px-1.5 py-0.5 rounded border border-line text-muted hidden sm:inline">Esc</kbd>
        </div>
        {/* scopes */}
        <div className="flex gap-1.5 px-3 py-2 border-b border-line2 overflow-x-auto shrink-0 [scrollbar-width:none]">
          {scopes.map((s) => (
            <button key={s.k} type="button" onClick={() => { setScope(s.k); input.current?.focus(); }}
              className={`h-7 px-2.5 rounded-full text-[12.5px] whitespace-nowrap border cursor-pointer ${scope === s.k ? "bg-ink text-white border-ink" : "bg-white border-line text-muted hover:text-ink"}`}>{s.label}</button>
          ))}
          {res?.filters.map((f) => <span key={f} className="h-7 px-2.5 rounded-full text-[12.5px] whitespace-nowrap bg-[#eaf1fb] text-[#2459a8] grid place-items-center">{f}</span>)}
        </div>
        {/* results + preview */}
        <div className="flex flex-1 min-h-0">
          <div ref={list} className="flex-1 min-w-0 overflow-y-auto py-1.5">
            {sections.map((s) => (
              <div key={s.label} className="mb-1">
                <div className="px-4 pt-2 pb-1 flex items-center gap-2"><span className="mono text-[10.5px] tracking-[.1em] text-muted uppercase">{s.label}</span>
                  {s.more && <button type="button" className="ml-auto text-[11.5px] text-muted underline hover:text-ink" onClick={() => setScope(s.more!.kind)}>see all</button>}</div>
                {s.hits.map((h) => {
                  n++; const i = n; const on = i === Math.min(sel, flat.length - 1);
                  return (
                    <button key={`${h.kind}-${h.id}-${s.label}`} type="button" data-i={i} onMouseMove={() => setSel(i)} onClick={(e) => go(h, e.ctrlKey || e.metaKey)}
                      className={`w-full flex items-center gap-3 px-3 mx-1 py-2 rounded-lg text-left cursor-pointer ${on ? "bg-[#f1efea]" : ""}`} style={{ width: "calc(100% - 8px)" }}>
                      <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${on ? "bg-ink text-white" : "bg-chip text-muted"}`}><Ico name={h.icon ?? (h.kind === "page" ? "arrow" : KIND_ICON[h.kind])} size={16} /></span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2"><span className={`truncate text-[14px] font-medium ${h.kind === "roll" || h.kind === "to" || h.kind === "batch" || h.kind === "po" ? "mono" : ""}`}><Hi s={h.title} q={res?.q ?? q} /></span>
                          {h.badge && <span className={`pill text-[11px] font-medium ${TONE[h.badge.tone]}`}>{h.badge.text}</span>}</span>
                        {h.subtitle && <span className="block truncate text-[12.5px] text-muted"><Hi s={h.subtitle} q={res?.q ?? q} /></span>}
                      </span>
                      {h.meta && <span className="mono text-[11.5px] text-muted shrink-0 hidden sm:block">{h.meta}</span>}
                      {on && <Ico name="arrow" size={14} className="text-muted shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ))}
            {!empty && !loading && flat.length === 0 && (
              <div className="px-6 py-10 text-center">
                <div className="font-semibold">Nothing found for “{q.trim()}”</div>
                <div className="text-sm text-muted mt-1">Try fewer letters, the Fabric # instead of the SKU, or switch the scope to All.</div>
                <button type="button" className="btn-ghost btn-sm mt-3" onClick={() => submit(false)}>Search on the Find page</button>
              </div>
            )}
            {empty && (
              <div className="px-4 py-3 m-2 rounded-xl bg-[#faf9f6] border border-line2 text-[12.5px] text-muted leading-relaxed">
                <div className="font-semibold text-ink mb-1">Search tips</div>
                Symbols and spaces don’t matter: <b className="mono text-ink">ct26po48</b> finds CT26/PO/48. A bare number like <b className="mono text-ink">12</b> finds TROC-012.<br />
                Narrow down with <b className="mono text-ink">roll:</b> <b className="mono text-ink">fab:</b> <b className="mono text-ink">to:</b> <b className="mono text-ink">rack:</b> <b className="mono text-ink">po:</b> <b className="mono text-ink">style:</b> <b className="mono text-ink">batch:</b> <b className="mono text-ink">loc:</b> or <b className="mono text-ink">#</b> for an order.<br />
                Filter rolls: <b className="mono text-ink">kg&lt;5 at:Exim</b> · <b className="mono text-ink">990A in:awaiting</b> · <b className="mono text-ink">at:R2-A</b>
              </div>
            )}
          </div>
          {/* preview */}
          {cur && cur.detail && (
            <div className="hidden md:flex w-[290px] shrink-0 border-l border-line bg-[#fcfbf9] p-4 flex-col gap-3 overflow-y-auto">
              <div className="flex items-center gap-2"><span className="w-9 h-9 rounded-lg grid place-items-center bg-ink text-white"><Ico name={cur.icon ?? (cur.kind === "page" ? "arrow" : KIND_ICON[cur.kind])} size={17} /></span>
                <div className="min-w-0"><div className={`font-semibold truncate ${cur.kind === "roll" || cur.kind === "to" ? "mono" : ""}`}>{cur.title}</div><div className="text-xs text-muted truncate">{cur.subtitle}</div></div></div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
                {cur.detail.map(([k, v]) => <Fragment key={k}><dt className="text-muted whitespace-nowrap">{k}</dt><dd className="font-medium break-words">{v}</dd></Fragment>)}
              </dl>
              <button type="button" className="btn btn-sm mt-auto" onClick={() => go(cur)}>Open</button>
            </div>
          )}
        </div>
        {/* footer */}
        <div className="hidden sm:flex items-center gap-4 px-4 h-10 border-t border-line text-[11.5px] text-muted shrink-0">
          <span><kbd className="mono px-1 rounded border border-line">↑↓</kbd> move</span><span><kbd className="mono px-1 rounded border border-line">Enter</kbd> open</span>
          <span><kbd className="mono px-1 rounded border border-line">Ctrl Enter</kbd> new tab</span><span><kbd className="mono px-1 rounded border border-line">Tab</kbd> scope</span>
          <span className="ml-auto">A scanned label opens straight away</span>
        </div>
      </div>
    </div>
  );
}
