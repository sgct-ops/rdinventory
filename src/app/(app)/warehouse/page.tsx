import { pageUser } from "@/lib/session";
import { warehouseData } from "@/lib/warehouse";
import { getSettings } from "@/lib/settings";
import { MapView } from "@/components/warehouse/MapView";

export default async function Page() {
  const u = await pageUser();
  const [d, s] = await Promise.all([warehouseData(), getSettings()]);
  return <MapView racks={d.racks} rolls={d.rolls} out={d.out} fullPct={Number(s.rackFullPct)} canWork={["ADMIN", "INVENTORY"].includes(u.role)} />;
}
