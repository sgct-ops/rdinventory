import { pageUser, NAV_ROLES } from "@/lib/session";
import { allowedLocations, fabricOptions, getDraft, batchMax } from "@/lib/queries";
import { todayIST } from "@/lib/units";
import { ReceiveForm } from "@/components/ReceiveForm";

export default async function Page() {
  const u = await pageUser(NAV_ROLES.register);
  const locs = (await allowedLocations(u)).filter((l) => l.type !== "PRODUCTION").map((l) => ({ id: l.id, name: l.name }));
  const [fabrics, draft, bm] = await Promise.all([fabricOptions(), getDraft(u, "RECEIVE"), batchMax()]);
  return <ReceiveForm fabrics={fabrics} locations={locs} today={todayIST()} draft={draft as never} isAdmin={u.role === "ADMIN"} batchMax={bm} />;
}
