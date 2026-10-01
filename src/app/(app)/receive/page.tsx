import { pageUser, NAV_ROLES } from "@/lib/session";
import { allowedLocations, activeLocations, fabricOptions, getDraft, batchMax } from "@/lib/queries";
import { todayIST } from "@/lib/units";
import { ReceiveForm } from "@/components/ReceiveForm";

export default async function Page() {
  const u = await pageUser(NAV_ROLES.register);
  const [mine, all, fabrics, draft, bm] = await Promise.all([allowedLocations(u), activeLocations(), fabricOptions(), getDraft(u, "RECEIVE"), batchMax()]);
  const fixed = u.receiveLocationId ? all.find((l) => l.id === u.receiveLocationId) : undefined;
  const locs = mine.filter((l) => l.type !== "PRODUCTION").map((l) => ({ id: l.id, name: l.name }));
  return <ReceiveForm fabrics={fabrics} locations={fixed ? [{ id: fixed.id, name: fixed.name }] : locs} fixedLocation={fixed ? { id: fixed.id, name: fixed.name } : null}
    userName={u.name || u.email} today={todayIST()} draft={draft as never} isAdmin={u.role === "ADMIN"} canEditPOs={NAV_ROLES.editPOs.includes(u.role)} batchMax={bm} />;
}
