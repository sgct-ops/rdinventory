import { pageUser, NAV_ROLES } from "@/lib/session";
import { allowedLocations, activeLocations, getDraft } from "@/lib/queries";
import { peekNextTO } from "@/lib/posting";
import { takenOutList } from "@/lib/floor";
import { todayIST } from "@/lib/units";
import { ConsumptionForm } from "@/components/ConsumptionForm";

export default async function Page() {
  const u = await pageUser(NAV_ROLES.consumption);
  const [all, mine, draft, next, out] = await Promise.all([activeLocations(), allowedLocations(u), getDraft(u, "CONSUMPTION"), peekNextTO("CONSUMPTION"), takenOutList()]);
  const sources = mine.filter((l) => l.type !== "PRODUCTION").map((l) => ({ id: l.id, name: l.name }));
  const prod = all.filter((l) => l.type === "PRODUCTION").map((l) => ({ id: l.id, name: l.name }));
  if (!sources.length) return <div className="p-8">No locations are assigned to you yet. Ask the admin to set your locations in Users.</div>;
  const store = sources.find((l) => l.name === "Rajdanga Storage");
  return <ConsumptionForm sources={sources} dests={prod.length ? prod : all.map((l) => ({ id: l.id, name: l.name }))} today={todayIST()} next={next} draft={draft as never}
    defaultDest={prod.length === 1 ? prod[0].id : undefined} defaultSrc={store?.id}
    takenOut={out.map((o) => ({ serial: o.serial, fabricNo: o.fabric_no, label: o.item_name, kgG: o.remaining_g, forPO: o.taken_out_for, purpose: o.taken_out_purpose }))} />;
}
