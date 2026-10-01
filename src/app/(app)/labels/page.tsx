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
        <div className="sub">Every roll whose label hasn&apos;t been scanned in: new rolls and cut pieces. A label keeps coming back here until it is scanned (put away at Rajdanga Storage, or Activate labels elsewhere). Labels are {s.labelWidthMm} × {s.labelHeightMm} mm at {s.labelDpi} dpi — change in Settings.</div></div>
      <details className="card px-4 py-3 text-sm">
        <summary className="font-semibold cursor-pointer">Printing on the TSC sticker printer</summary>
        <ol className="list-decimal pl-5 mt-2 flex flex-col gap-1">
          <li>In the TSC driver (Printing Preferences → Page Setup) make a stock of <b>{s.labelWidthMm} × {s.labelHeightMm} mm</b>, orientation <b>Landscape</b>, and pick the right media (gap / black mark).</li>
          <li>In the PDF print dialog choose <b>Actual size</b> (100%) — not &quot;Fit&quot; or &quot;Shrink&quot;. Scaling makes the bars uneven.</li>
          <li>If the bars look grey or broken, raise <b>Darkness</b> (e.g. 10–12) and lower <b>Speed</b> (2–3 ips) in the driver&apos;s Options. Turn off any dithering / halftone.</li>
          <li>For a 300 dpi TSC, set Printer dpi to 300 in Settings so the bars line up with its dots.</li>
        </ol>
        <div className="text-muted mt-2">The big barcode is the roll serial (that&apos;s all the app needs — the invoice and batch come from it). The small QR holds serial|invoice|batch for 2D scanners.</div>
      </details>
      <LabelQueue rows={rows.map(({ r, f, b, l }) => ({ id: r.id, serial: r.serial, fabric: `${f.fabricNo} · ${f.cwFabricCode ?? f.itemName}${f.colour ? " " + f.colour : ""}`, batch: b.code,
        kg: fmtKg(r.remainingG, 2), registered: fmtDateTime(r.createdAt), printed: !!r.labelPrintedAt, location: l.name, cut: r.splitFromId ? "cut piece" : "" }))} />
    </div>
  );
}
