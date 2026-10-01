import { pageUser, NAV_ROLES } from "@/lib/session";
import { labelQueue } from "@/lib/posting";
import { ActivateLabels } from "@/components/ActivateLabels";

export default async function Page() {
  await pageUser(NAV_ROLES.activate);
  const q = await labelQueue();
  return <ActivateLabels queue={q.map(({ r, f, l }) => ({ serial: r.serial, fabric: `${f.fabricNo} · ${f.cwFabricCode ?? f.itemName} ${f.colour ?? ""}`, kgG: r.remainingG, location: l.name, cut: !!r.splitFromId }))} />;
}
