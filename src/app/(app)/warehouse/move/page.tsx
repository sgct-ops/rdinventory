import { pageUser, NAV_ROLES } from "@/lib/session";
import { warehouseData } from "@/lib/warehouse";
import { MoveView } from "@/components/warehouse/MoveView";

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await pageUser(NAV_ROLES.activate);
  const sp = await searchParams;
  const d = await warehouseData();
  const byCode = new Map(d.racks.map((r) => [r.code, r]));
  const from = sp.from && byCode.has(sp.from) ? sp.from : null;
  const to = sp.to && byCode.has(sp.to) && sp.to !== from ? sp.to : null;
  const rows = (code: string | null) => code ? d.rolls.filter((r) => r.rackId === byCode.get(code)!.id)
    .map((r) => ({ serial: r.serial, hex: r.hex, fab: `${r.item}${r.colour ? " · " + r.colour : ""}`, remainingG: r.remainingG })) : [];
  const meta = Object.fromEntries(d.racks.map((r) => [r.code, { n: d.rolls.filter((x) => x.rackId === r.id).length, cap: r.capacity, room: r.room }]));
  return <MoveView from={from} to={to} fromList={rows(from)} toList={rows(to)} meta={meta} />;
}
