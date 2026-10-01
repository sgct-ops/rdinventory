import { pageUser, NAV_ROLES } from "@/lib/session";
import { warehouseData } from "@/lib/warehouse";
import { PutAway } from "@/components/warehouse/PutAway";

export default async function Page() {
  await pageUser(NAV_ROLES.activate);
  const d = await warehouseData();
  const waiting = d.rolls.filter((r) => !r.rackId && r.offRackReason !== "TAKEN_OUT").map((r) => ({
    serial: r.serial, hex: r.hex,
    why: r.status === "AWAITING_LABEL" ? "New · label" : r.offRackReason === "RETURNED" ? "Back" : r.offRackReason === "ARRIVED" ? "Arrived" : "New",
  }));
  const rackCounts = Object.fromEntries(d.racks.map((r) => [r.code, { n: d.rolls.filter((x) => x.rackId === r.id).length, cap: r.capacity, room: r.room }]));
  return <PutAway waiting={waiting} rackCounts={rackCounts} />;
}
