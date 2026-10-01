import { pageUser, NAV_ROLES } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { labelQueue } from "@/lib/posting";
import { fmtDateTime, fmtKg } from "@/lib/units";
import { LabelQueue } from "@/components/LabelQueue";

export default async function Page() {
  await pageUser(NAV_ROLES.labels);
  const s = await getSettings();
  const rows = await labelQueue();
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-4">
      <div><div className="h1">Print labels</div>
        <div className="sub">Every roll whose label hasn&apos;t been scanned in: new rolls and cut pieces. A label keeps coming back here until it is scanned (put away at Rajdanga Storage, or Activate labels elsewhere). Labels are {s.labelWidthMm} × {s.labelHeightMm} mm — change in Settings.</div></div>
      <LabelQueue rows={rows.map(({ r, f, b, l }) => ({ id: r.id, serial: r.serial, fabric: `${f.fabricNo} · ${f.cwFabricCode ?? f.itemName}${f.colour ? " " + f.colour : ""}`, batch: b.code,
        kg: fmtKg(r.remainingG, 2), registered: fmtDateTime(r.createdAt), printed: !!r.labelPrintedAt, location: l.name, cut: r.splitFromId ? "cut piece" : "" }))} />
    </div>
  );
}
