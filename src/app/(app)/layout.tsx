import { cookies } from "next/headers";
import { pageUser, NAV_ROLES, type Role } from "@/lib/session";
import { signOut } from "@/auth";
import { Sidebar, MobileNav, type NavGroup, type NavItem } from "@/components/Nav";
import { GlobalScan } from "@/components/GlobalScan";
import { CommandPalette, type PaletteAction } from "@/components/CommandPalette";
import { attentionFor } from "@/lib/attention";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [u, jar] = await Promise.all([pageUser(), cookies()]);
  const is = (roles: Role[]) => roles.includes(u.role);
  const att = await attentionFor(u.role);
  const when = <T,>(roles: Role[], items: T[]) => (is(roles) ? items : []);

  const dash: NavItem = { href: "/", label: "Dashboard", icon: "home" };
  const groups: NavGroup[] = [
    { id: "receive", theme: "receive" as const, title: "Receive", items: [
      ...when<NavItem>(NAV_ROLES.register, [{ href: "/receive", label: "Receive fabric", icon: "inbox", hint: "Weigh and register the rolls of a fabric PO" }]),
      ...when<NavItem>(NAV_ROLES.labels, [{ href: "/labels", label: "Print labels", icon: "tag", badge: att.labels }]),
      ...when<NavItem>(NAV_ROLES.activate, [
        { href: "/labels/activate", label: "Activate labels", icon: "scan", hint: "For rolls that are not going onto a Rajdanga rack" },
        { href: "/warehouse/put", label: "Put away on racks", icon: "rack", badge: att.unplaced, hint: "Scan a rack, then its rolls. New labels are activated by the same scan." },
      ]),
    ] },
    { id: "move", theme: "move" as const, title: "Move & use", items: [
      ...when<NavItem>(NAV_ROLES.transfer, [{ href: "/to/transfer", label: "Send to a location", icon: "send", code: "TROR" }]),
      ...when<NavItem>(NAV_ROLES.consumption, [{ href: "/to/consumption", label: "Use in production", icon: "scissors", code: "TROC" }]),
      ...when<NavItem>(NAV_ROLES.activate, [{ href: "/warehouse/move", label: "Move between racks", icon: "move" }]),
      ...when<NavItem>(NAV_ROLES.adjust, [{ href: "/adjustments/new", label: "Adjust a roll", icon: "adjust", hint: "Weight is wrong, damage, found or lost" }]),
    ] },
    { id: "check", theme: "check" as const, title: "Check & approve", items: [
      ...when<NavItem>(NAV_ROLES.activate, [{ href: "/warehouse/count", label: "Count a rack", icon: "count" }]),
      ...when<NavItem>(NAV_ROLES.approve, [{ href: "/adjustments", label: "Approve adjustments", icon: "check", badge: att.pending }]),
      ...when<NavItem>(NAV_ROLES.check, [{ href: "/check", label: "Carbonwork check", icon: "compare" }]),
      ...when<NavItem>(NAV_ROLES.log, [{ href: "/zoho", label: "Zoho prompt", icon: "zoho", badge: att.zoho, badgeTone: "quiet", hint: "A prompt for Claude to key the TROs into Zoho" }]),
    ] },
    { id: "records", theme: "history" as const, title: "Stock & history", items: [
      { href: "/warehouse", label: "Rack map", icon: "map" } as NavItem,
      { href: "/rolls", label: "All rolls", icon: "roll" } as NavItem,
      ...when<NavItem>(NAV_ROLES.log, [
        { href: "/log", label: "Transfer orders", icon: "list", hint: "Every TROR and TROC (the TO Log)" },
        { href: "/orders", label: "Customer orders", icon: "hash", hint: "Which order numbers used which fabric" },
      ]),
      { href: "/warehouse/log", label: "Rack movements", icon: "history" } as NavItem,
      { href: "/warehouse/counts", label: "Past counts", icon: "count" } as NavItem,
      ...when<NavItem>(["ADMIN", "INVENTORY", "MERCHANDISER"], [{ href: "/adjustments/list", label: "Past adjustments", icon: "adjust" }]),
      ...when<NavItem>(["ADMIN"], [{ href: "/audit", label: "Audit trail", icon: "shield" }]),
      ...(is(NAV_ROLES.masters) ? [] : [{ href: "/formats", label: "Number formats", icon: "ruler" } as NavItem]),
    ] },
    ...when<NavGroup>(NAV_ROLES.masters, [{ id: "setup", theme: "setup" as const, title: "SETUP", collapsed: true, items: [
      { href: "/admin/fabrics", label: "Fabrics", icon: "fabric" },
      { href: "/admin/locations", label: "Locations", icon: "pin" },
      { href: "/admin/racks", label: "Racks", icon: "rack" },
      { href: "/admin/users", label: "Users & access", icon: "users" },
      { href: "/formats", label: "Number formats", icon: "ruler" },
      { href: "/admin/settings", label: "Settings", icon: "cog" },
      { href: "/admin/tools", label: "Tools", icon: "wrench", hint: "Demo data, rebuild balances, backups" },
    ] }]),
  ].filter((g) => g.items.length);

  // every page the person may open, for the Ctrl K finder
  const actions: PaletteAction[] = [dash, ...groups.flatMap((g) => g.items.map((i) => ({ ...i, section: g.title })))]
    .map((i) => ({ href: i.href, label: i.label, icon: i.icon, code: i.code, hint: i.hint, section: "section" in i ? String(i.section) : "Overview" }));

  const nav = { dash, groups, attention: att.items };
  return (
    <div className="min-h-dvh flex w-full max-w-[100vw]">
      <Sidebar {...nav} initialRail={jar.get("nav_rail")?.value === "1"} />
      <div className="flex flex-col flex-1 min-w-0">
        <header className="flex items-center gap-2 sm:gap-3 h-[60px] px-3 lg:px-5 border-b border-line bg-white/95 backdrop-blur sticky top-0 z-20 min-w-0">
          <MobileNav {...nav} />
          <GlobalScan />
          {process.env.APP_ENV === "test" && <span className="pill bg-warn font-semibold hidden sm:inline-block">TEST COPY</span>}
          <div className="ml-auto flex items-center gap-3 text-xs text-muted shrink-0">
            <span className="hidden xl:inline truncate">{u.email} · <b className="text-ink">{u.role}</b></span>
            <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}><button className="btn-ghost btn-sm" title="Sign out" aria-label="Sign out"><span className="hidden sm:inline">Sign out</span><svg className="sm:hidden" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg></button></form>
          </div>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <CommandPalette actions={actions} role={u.role} />
    </div>
  );
}
