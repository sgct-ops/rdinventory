"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ico, type Icon } from "@/components/icons";

export type { Icon };
export type NavItem = { href: string; label: string; icon: Icon; code?: string; hint?: string; badge?: number; badgeTone?: "warn" | "quiet" };
export type SectionTheme = "receive" | "move" | "check" | "history" | "setup";
export type NavGroup = { id: string; title: string; theme: SectionTheme; items: NavItem[]; collapsed?: boolean };
export type Attention = { href: string; text: string; detail?: string; n: number; tone: "warn" | "bad" | "quiet"; icon: Icon;
  samples?: { label: string; sub?: string; href: string }[]; action?: string };

/* Each section has its own colour, type and layout so they never blur together. */
const THEME: Record<SectionTheme, { fg: string; bg: string; ring: string; tile: string }> = {
  receive: { fg: "oklch(0.48 0.13 250)", bg: "oklch(0.975 0.014 250)", ring: "oklch(0.88 0.04 250)", tile: "oklch(0.93 0.04 250)" },
  move: { fg: "oklch(0.47 0.11 160)", bg: "oklch(0.975 0.016 160)", ring: "oklch(0.88 0.04 160)", tile: "oklch(0.93 0.045 160)" },
  check: { fg: "oklch(0.48 0.14 300)", bg: "oklch(0.975 0.014 300)", ring: "oklch(0.89 0.035 300)", tile: "oklch(0.935 0.04 300)" },
  history: { fg: "oklch(0.5 0.11 60)", bg: "oklch(0.977 0.018 75)", ring: "oklch(0.89 0.05 75)", tile: "oklch(0.935 0.05 75)" },
  setup: { fg: "#f6f5f2", bg: "#1c1b19", ring: "#1c1b19", tile: "#2c2b28" },
};

function useActive(all: string[]) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
  return all.filter(isActive).sort((a, b) => b.length - a.length)[0];
}
const openFind = () => window.dispatchEvent(new CustomEvent("open-find"));

/* ---------------------------------------------------------------- bell + attention panel */
const GROUPS: { tone: Attention["tone"]; title: string; hint: string }[] = [
  { tone: "bad", title: "Urgent", hint: "Blocking stock or waiting on you" },
  { tone: "warn", title: "To do today", hint: "Floor work that keeps stock right" },
  { tone: "quiet", title: "When you're ready", hint: "No rush, but don't let it pile up" },
];
const TONE_TILE: Record<Attention["tone"], string> = { bad: "bg-badbg text-bad", warn: "bg-warnbg text-[oklch(0.5_0.12_70)]", quiet: "bg-chip text-muted" };
const TONE_BAR: Record<Attention["tone"], string> = { bad: "bg-bad", warn: "bg-warn", quiet: "bg-line" };

function AttentionPanel({ items, loading, onClose, left }: { items: Attention[]; loading: boolean; onClose: () => void; left: number }) {
  const urgent = items.filter((a) => a.tone !== "quiet").reduce((s, a) => s + a.n, 0);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { panel.current?.focus(); }, []);
  return (
    <div className="fixed inset-0 z-[55]" role="presentation">
      <div className="absolute inset-0 bg-[rgb(28_27_25/.25)]" onClick={onClose} />
      <div ref={panel} tabIndex={-1} role="dialog" aria-label="Needs attention"
        className="absolute top-0 bottom-0 w-[400px] max-w-[100vw] bg-paper border-r border-line shadow-2xl flex flex-col outline-none animate-[slidein_.18s_ease-out]"
        style={{ left: Math.min(left, typeof window === "undefined" ? left : Math.max(0, window.innerWidth - 400)) }}>
        <div className="flex items-center gap-3 px-5 h-[60px] border-b border-line bg-white shrink-0">
          <span className="w-9 h-9 rounded-lg grid place-items-center bg-ink text-white"><Ico name="bell" size={18} /></span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[15px] leading-tight">Needs attention</div>
            <div className="text-xs text-muted">{loading && !items.length ? "Checking…" : urgent ? `${urgent} thing${urgent === 1 ? "" : "s"} to do` : "All clear"}</div>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm" aria-label="Close">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 flex flex-col gap-5">
          {!items.length && !loading && (
            <div className="card p-8 text-center"><div className="text-3xl mb-2">✓</div><div className="font-semibold">Nothing waiting</div><div className="text-sm text-muted mt-1">Every label is scanned, every roll is on a rack and nothing needs approving.</div></div>
          )}
          {GROUPS.map((g) => {
            const list = items.filter((a) => a.tone === g.tone);
            if (!list.length) return null;
            return (
              <section key={g.tone} aria-label={g.title}>
                <div className="flex items-baseline gap-2 mb-2 px-1">
                  <span className={`w-2 h-2 rounded-full ${TONE_BAR[g.tone]}`} />
                  <span className="text-[12px] font-semibold tracking-[.06em] uppercase">{g.title}</span>
                  <span className="text-[11.5px] text-muted">{g.hint}</span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {list.map((a) => (
                    <div key={a.href + a.text} className="card overflow-hidden flex">
                      <span className={`w-1 shrink-0 ${TONE_BAR[a.tone]}`} aria-hidden />
                      <div className="flex-1 min-w-0 p-3.5">
                        <div className="flex items-start gap-3">
                          <span className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${TONE_TILE[a.tone]}`}><Ico name={a.icon} size={17} /></span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-semibold leading-snug"><span className="mono">{a.n}</span> {a.text}</div>
                            {a.detail && <div className="text-[12.5px] text-muted mt-0.5">{a.detail}</div>}
                          </div>
                        </div>
                        {a.samples && a.samples.length > 0 && (
                          <ul className="mt-3 flex flex-col rounded-lg border border-line2 bg-[#fcfbf9] divide-y divide-line2">
                            {a.samples.map((x) => (
                              <li key={x.label}><Link href={x.href} onClick={onClose} className="flex items-center gap-2 px-3 py-2 text-[12.5px] hover:bg-white hover:text-ink">
                                <span className="mono font-medium truncate">{x.label}</span>
                                {x.sub && <span className="text-muted truncate">· {x.sub}</span>}
                                <Ico name="chevR" size={12} className="ml-auto text-faint" />
                              </Link></li>))}
                            {a.n > a.samples.length && <li className="px-3 py-1.5 text-[11.5px] text-muted">and {a.n - a.samples.length} more</li>}
                          </ul>
                        )}
                        {!a.samples && loading && <div className="mt-3 h-16 rounded-lg bg-line2 animate-pulse" />}
                        <Link href={a.href} onClick={onClose} className={`mt-3 h-9 rounded-lg flex items-center justify-center gap-2 text-[13px] font-semibold ${a.tone === "quiet" ? "border border-line bg-white hover:border-ink" : "bg-ink text-white hover:bg-black hover:text-white"}`}>
                          {a.action ?? "Open"}<Ico name="arrow" size={14} />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        <div className="px-5 py-2.5 border-t border-line bg-white text-[11.5px] text-muted shrink-0">Updates every minute and whenever you change page · <kbd className="mono px-1 rounded border border-line">Esc</kbd> to close</div>
      </div>
    </div>
  );
}

function Bell({ attention, rail }: { attention: Attention[]; rail: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(attention);
  const [loading, setLoading] = useState(false);
  const [left, setLeft] = useState(276);
  const btn = useRef<HTMLButtonElement>(null);
  const path = usePathname();
  useEffect(() => setItems(attention), [attention]);
  const load = useCallback((full: boolean) => {
    if (full) setLoading(true);
    return fetch(`/api/attention${full ? "?full=1" : ""}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setItems((old) => full ? d.items : d.items.map((n: Attention) => ({ ...n, samples: old.find((o) => o.href === n.href && o.icon === n.icon)?.samples, action: old.find((o) => o.icon === n.icon)?.action }))); })
      .catch(() => {}).finally(() => full && setLoading(false));
  }, []);
  // refresh the counts whenever you change page, and every minute
  useEffect(() => { load(false); const t = setInterval(() => load(false), 60_000); return () => clearInterval(t); }, [path, load]);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [open]);
  const toggle = () => {
    if (open) return setOpen(false);
    const aside = btn.current?.closest("aside, [data-drawer]") as HTMLElement | null;
    setLeft(aside && window.innerWidth >= 640 ? aside.getBoundingClientRect().right : 0);
    setOpen(true); load(true);
  };
  const urgent = items.filter((a) => a.tone !== "quiet").reduce((s, a) => s + a.n, 0);
  const bad = items.some((a) => a.tone === "bad");
  return (
    <div className={`relative ${rail ? "" : "flex-[0_0_30%]"}`}>
      <button ref={btn} type="button" onClick={toggle} aria-label={`Notifications${urgent ? `: ${urgent} need attention` : ""}`} aria-expanded={open} title="Needs attention"
        className={`relative w-full h-10 grid place-items-center rounded-lg border transition-colors cursor-pointer ${open ? "bg-ink text-white border-ink" : "bg-white border-line hover:border-ink text-ink"}`}>
        <Ico name="bell" size={18} className={urgent ? "animate-[ring_2.5s_ease-in-out_1]" : ""} />
        {urgent > 0 && <span className={`absolute -top-1.5 -right-1.5 mono text-[10.5px] min-w-[19px] h-[19px] px-1 grid place-items-center rounded-full font-semibold ring-2 ring-white ${bad ? "bg-bad text-white" : "bg-warn text-ink"}`}>{urgent > 99 ? "99+" : urgent}</span>}
      </button>
      {open && typeof document !== "undefined" && createPortal(<AttentionPanel items={items} loading={loading} onClose={() => setOpen(false)} left={left} />, document.body)}
    </div>
  );
}

/* ---------------------------------------------------------------- sections */
function Badge({ i, on }: { i: NavItem; on: boolean }) {
  if (!i.badge) return null;
  return <span className={`ml-auto mono text-[10.5px] min-w-5 h-5 px-1.5 grid place-items-center rounded-full font-semibold ${on ? "bg-white text-ink" : i.badgeTone === "quiet" ? "bg-white/80 text-muted ring-1 ring-line" : "bg-warn text-ink"}`}>{i.badge}</span>;
}

function WorkSection({ g, current, step }: { g: NavGroup; current?: string; step: number }) {
  const t = THEME[g.theme];
  const stepper = g.theme === "receive";
  return (
    <section className="rounded-xl border p-1.5 pb-2" style={{ background: t.bg, borderColor: t.ring }} aria-label={g.title}>
      <div className="flex items-center gap-2 px-2 pt-1 pb-1.5">
        <span className="w-5 h-5 rounded-md grid place-items-center text-[11px] font-bold text-white" style={{ background: t.fg }}>{step}</span>
        <span className="text-[11.5px] font-semibold tracking-[.06em] uppercase" style={{ color: t.fg }}>{g.title}</span>
      </div>
      <div className={`flex flex-col ${stepper ? "relative" : "gap-0.5"}`}>
        {stepper && <span className="absolute left-[21px] top-4 bottom-4 w-px" style={{ background: t.ring }} aria-hidden />}
        {g.items.map((i, n) => {
          const on = current === i.href;
          return (
            <Link key={i.href} href={i.href} title={i.hint} aria-current={on ? "page" : undefined}
              className={`relative flex items-center gap-2.5 h-9 px-2 rounded-lg text-[13.5px] transition-colors ${on ? "text-white font-medium shadow-sm hover:text-white" : "text-[#2c2b28] hover:bg-white/80 hover:text-ink"}`}
              style={on ? { background: t.fg } : undefined}>
              {stepper
                ? <span className="relative z-[1] w-[26px] h-[26px] rounded-full grid place-items-center text-[11px] font-bold border-2 shrink-0"
                    style={on ? { background: "white", color: t.fg, borderColor: "white" } : { background: "white", color: t.fg, borderColor: t.ring }}>{n + 1}</span>
                : <span className="w-[26px] h-[26px] rounded-md grid place-items-center shrink-0" style={{ background: on ? "rgb(255 255 255 / .18)" : t.tile, color: on ? "white" : t.fg }}><Ico name={i.icon} size={15} /></span>}
              <span className="truncate">{i.label}</span>
              {i.code && <span className="mono text-[10px] px-1 py-px rounded font-semibold" style={on ? { background: "rgb(255 255 255 / .2)" } : { background: t.tile, color: t.fg }}>{i.code}</span>}
              <Badge i={i} on={on} />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function SetupSection({ g, current, open, toggle }: { g: NavGroup; current?: string; open: boolean; toggle: () => void }) {
  return (
    <section className="rounded-xl bg-ink text-[#f6f5f2] p-2" aria-label={g.title}>
      <button type="button" onClick={toggle} aria-expanded={open} className="w-full flex items-center gap-2 px-1 py-0.5 cursor-pointer">
        <Ico name="cog" size={14} className="text-[#9a968d]" /><span className="mono text-[10.5px] tracking-[.12em] text-[#c9c5bc]">{g.title}</span>
        <Ico name="chevR" size={12} className={`ml-auto text-[#9a968d] transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && <div className="grid grid-cols-2 gap-1 mt-2">{g.items.map((i) => {
        const on = current === i.href;
        return (
          <Link key={i.href} href={i.href} title={i.hint} aria-current={on ? "page" : undefined}
            className={`flex flex-col items-start gap-1.5 p-2 rounded-lg text-[12px] leading-tight ${on ? "bg-white text-ink hover:text-ink" : "bg-[#2c2b28] text-[#e8e5de] hover:bg-[#3a3935] hover:text-white"}`}>
            <Ico name={i.icon} size={15} className={on ? "" : "text-[#b4b0a7]"} />{i.label}
          </Link>);
      })}</div>}
    </section>
  );
}

/* ---------------------------------------------------------------- rail (collapsed) */
function Rail({ dash, groups, current }: { dash: NavItem; groups: NavGroup[]; current?: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {[dash].map((i) => <RailLink key={i.href} i={i} on={current === i.href} color="#1c1b19" />)}
      <button type="button" onClick={openFind} title="Find anything (Ctrl K)" aria-label="Find anything" className="w-10 h-10 grid place-items-center rounded-lg text-muted hover:bg-chip hover:text-ink cursor-pointer"><Ico name="search" /></button>
      {groups.map((g) => (
        <div key={g.id} className="flex flex-col items-center gap-1 w-full pt-2 mt-1 border-t-2" style={{ borderColor: g.theme === "setup" ? "#1c1b19" : THEME[g.theme].fg }}>
          {g.items.map((i) => <RailLink key={i.href} i={i} on={current === i.href} color={g.theme === "setup" ? "#1c1b19" : THEME[g.theme].fg} />)}
        </div>
      ))}
    </div>
  );
}
function RailLink({ i, on, color }: { i: NavItem; on: boolean; color: string }) {
  return (
    <Link href={i.href} title={i.code ? `${i.label} · ${i.code}` : i.label} aria-label={i.label} aria-current={on ? "page" : undefined}
      className={`relative w-10 h-10 grid place-items-center rounded-lg ${on ? "text-white hover:text-white" : "hover:bg-chip"}`} style={on ? { background: color } : { color }}>
      <Ico name={i.icon} />
      {!!i.badge && i.badgeTone !== "quiet" && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-warn ring-2 ring-white" />}
    </Link>
  );
}

/* ---------------------------------------------------------------- the sidebar */
const COOKIE = "nav_rail";
const KEY = "nav-open-v2";

export function Sidebar({ dash, groups, attention, initialRail }: { dash: NavItem; groups: NavGroup[]; attention: Attention[]; initialRail: boolean }) {
  const current = useActive([dash.href, "/find", ...groups.flatMap((g) => g.items.map((i) => i.href))]);
  const [rail, setRail] = useState(initialRail);
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(groups.map((g) => [g.id, !g.collapsed])));
  useEffect(() => { try { const s = localStorage.getItem(KEY); if (s) setOpen((o) => ({ ...o, ...JSON.parse(s) })); } catch {} }, []);
  const toggleGroup = (id: string) => setOpen((o) => { const n = { ...o, [id]: !o[id] }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch {} return n; });
  const toggleRail = useCallback(() => setRail((r) => {
    const n = !r; document.cookie = `${COOKIE}=${n ? 1 : 0}; path=/; max-age=31536000; samesite=lax`; return n;
  }), []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") { e.preventDefault(); toggleRail(); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [toggleRail]);

  const work = groups.filter((g) => ["receive", "move", "check", "history"].includes(g.theme));
  const rest = groups.filter((g) => !["receive", "move", "check", "history"].includes(g.theme));

  return (
    <aside className={`hidden lg:flex flex-col shrink-0 border-r border-line bg-white sticky top-0 h-dvh transition-[width] duration-200 ${rail ? "w-[68px]" : "w-[276px]"}`}>
      <div className={`flex items-center h-[60px] border-b border-line shrink-0 ${rail ? "justify-center" : "px-4 gap-2.5"}`}>
        <Link href="/" className="flex items-center gap-2.5 font-semibold text-[15px] hover:text-ink" title="Rajdanga Fabric"><span className="w-[26px] h-[26px] bg-ink rounded-[7px] grid place-items-center text-white text-[11px] font-bold">RF</span>{!rail && "Rajdanga Fabric"}</Link>
      </div>
      <div className={`flex-1 overflow-y-auto overscroll-contain ${rail ? "px-[14px] py-3" : "px-3 py-3"} flex flex-col gap-3 [&>*]:shrink-0`}>
        {rail ? (
          <>
            <Bell attention={attention} rail />
            <Rail dash={dash} groups={groups} current={current} />
          </>
        ) : (
          <>
            <div className="flex gap-2">
              <Bell attention={attention} rail={false} />
              <Link href={dash.href} aria-current={current === dash.href ? "page" : undefined}
                className={`flex-1 h-10 rounded-lg flex items-center gap-2 px-3 text-[13.5px] font-semibold border ${current === dash.href ? "bg-ink text-white border-ink hover:text-white" : "bg-white border-line hover:border-ink hover:text-ink"}`}>
                <Ico name="home" size={17} />Dashboard
              </Link>
            </div>
            <button type="button" onClick={openFind} className="h-10 w-full flex items-center gap-2 px-3 rounded-lg bg-[#f1efea] hover:bg-chip text-muted text-[13px] cursor-pointer text-left">
              <Ico name="search" size={16} /><span className="flex-1">Find anything…</span><kbd className="mono text-[10.5px] px-1.5 py-0.5 rounded bg-white border border-line">Ctrl K</kbd>
            </button>
            {work.map((g, n) => <WorkSection key={g.id} g={g} current={current} step={n + 1} />)}
            {rest.map((g) => g.theme === "setup"
              ? <SetupSection key={g.id} g={g} current={current} open={!!open[g.id] || g.items.some((i) => i.href === current)} toggle={() => toggleGroup(g.id)} />
              : null)}
          </>
        )}
      </div>
      <button type="button" onClick={toggleRail} title={rail ? "Expand menu (Ctrl B)" : "Collapse menu (Ctrl B)"} aria-label={rail ? "Expand menu" : "Collapse menu"}
        className={`h-11 shrink-0 border-t border-line flex items-center gap-2 text-xs text-muted hover:text-ink hover:bg-[#faf9f6] cursor-pointer ${rail ? "justify-center" : "px-4"}`}>
        <Ico name={rail ? "chevR" : "chevL"} size={16} />{!rail && <><span>Collapse menu</span><kbd className="ml-auto mono text-[10px] px-1.5 rounded border border-line">Ctrl B</kbd></>}
      </button>
    </aside>
  );
}

/** Phone / tablet: a slide-in drawer with the full menu. Closes when you pick a page. */
export function MobileNav({ dash, groups, attention }: { dash: NavItem; groups: NavGroup[]; attention: Attention[] }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const current = useActive([dash.href, ...groups.flatMap((g) => g.items.map((i) => i.href))]);
  useEffect(() => setOpen(false), [path]);
  const [gOpen, setGOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(groups.map((g) => [g.id, !g.collapsed])));
  const work = groups.filter((g) => ["receive", "move", "check", "history"].includes(g.theme));
  const rest = groups.filter((g) => !["receive", "move", "check", "history"].includes(g.theme));
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost btn-sm h-10 lg:hidden shrink-0" aria-label="Open menu">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/35" onClick={() => setOpen(false)} />
          <div data-drawer className="absolute left-0 top-0 h-dvh w-[300px] max-w-[88vw] bg-white border-r border-line p-3 overflow-y-auto shadow-xl flex flex-col gap-3 [&>*]:shrink-0">
            <div className="flex items-center justify-between px-1">
              <span className="font-semibold text-[15px]">Rajdanga Fabric</span>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close menu">✕</button>
            </div>
            <div className="flex gap-2">
              <Bell attention={attention} rail={false} />
              <Link href={dash.href} className={`flex-1 h-10 rounded-lg flex items-center gap-2 px-3 text-[13.5px] font-semibold border ${current === dash.href ? "bg-ink text-white border-ink" : "bg-white border-line"}`}><Ico name="home" size={17} />Dashboard</Link>
            </div>
            <button type="button" onClick={() => { setOpen(false); openFind(); }} className="h-10 w-full flex items-center gap-2 px-3 rounded-lg bg-[#f1efea] text-muted text-[13px] text-left"><Ico name="search" size={16} />Find anything…</button>
            {work.map((g, n) => <WorkSection key={g.id} g={g} current={current} step={n + 1} />)}
            {rest.map((g) => g.theme === "setup"
              ? <SetupSection key={g.id} g={g} current={current} open={!!gOpen[g.id]} toggle={() => setGOpen((o) => ({ ...o, [g.id]: !o[g.id] }))} />
              : null)}
          </div>
        </div>
      )}
    </>
  );
}
