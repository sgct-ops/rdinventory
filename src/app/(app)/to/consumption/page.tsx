import { pageUser, NAV_ROLES } from "@/lib/session";
import { allowedLocations, activeLocations, fabricOptions, getDraft } from "@/lib/queries";
import { peekNextTO } from "@/lib/posting";
import { todayIST } from "@/lib/units";
import { OrderForm } from "@/components/OrderForm";

export default async function Page() {
  const u = await pageUser(NAV_ROLES.consumption);
  const all = await activeLocations();
  const mine = await allowedLocations(u);
  const sources = mine.filter((l) => l.type !== "PRODUCTION").map((l) => ({ id: l.id, name: l.name }));
  const prod = all.filter((l) => l.type === "PRODUCTION");
  const dests = (("CONSUMPTION" as string) === "CONSUMPTION" ? (prod.length ? prod : all) : all.filter((l) => l.type !== "PRODUCTION")).map((l) => ({ id: l.id, name: l.name }));
  if (!sources.length) return <div className="p-8">No locations are assigned to you yet. Ask the admin to set your locations in Users.</div>;
  const [fabrics, draft, next] = await Promise.all([fabricOptions(), getDraft(u, "CONSUMPTION"), peekNextTO("CONSUMPTION")]);
  return <OrderForm kind="CONSUMPTION" fabrics={fabrics} sources={sources} dests={dests} today={todayIST()} next={next} draft={draft as never}
    defaultDest={("CONSUMPTION" as string) === "CONSUMPTION" && prod.length === 1 ? prod[0].id : undefined} />;
}
