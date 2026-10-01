import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser, NAV_ROLES } from "@/lib/session";
import { fmtDate, fmtDateTime, fmtKg } from "@/lib/units";
import type { CheckRow } from "@/lib/check";
import { CheckWeigh } from "@/components/CheckWeigh";

const FLAG: Record<CheckRow["flag"], [string, string]> = { OK: ["OK", "bg-okbg"], CHECK: ["Check", "bg-warnbg"], ONLY_CW: ["Only in Carbonwork", "bg-badbg"], ONLY_SHEET: ["Only in app", "bg-badbg"] };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await pageUser(NAV_ROLES.check);
  const { id } = await params;
  const [c] = await db.select().from(schema.checks).where(eq(schema.checks.id, id));
  if (!c) notFound();
  const res = c.results as { rows: CheckRow[]; postedSinceFile: number };
  const tm = c.toMatch as { onlyInCarbonwork: string[]; onlyInSheet: string[] } | null;
  const ws = await db.select({ w: schema.spotWeighs, r: schema.rolls, l: schema.locations, k: schema.racks }).from(schema.spotWeighs)
    .innerJoin(schema.rolls, eq(schema.rolls.id, schema.spotWeighs.rollId)).innerJoin(schema.locations, eq(schema.locations.id, schema.rolls.currentLocationId))
    .leftJoin(schema.racks, eq(schema.racks.id, schema.rolls.rackId)).where(eq(schema.spotWeighs.checkId, c.id));
  return (
    <div className="p-5 lg:p-7 flex flex-col gap-5">
      <div className="flex items-end gap-4 flex-wrap">
        <div><div className="text-[13px] text-muted"><Link className="underline" href="/check">Carbonwork check</Link> / {fmtDateTime(c.createdAt)}</div>
          <div className="h1">{c.fileName}</div>
          <div className="sub">{c.rowsChecked} rows · <b className={c.rowsFlagged ? "text-bad" : ""}>{c.rowsFlagged} flagged</b> · {fmtKg(c.kgGapG, 1)} kg gap · {c.status === "DONE" ? `saved ${fmtDateTime(c.finishedAt)}` : "open"}</div></div>
      </div>
      {res.postedSinceFile > 0 && <div className="text-sm bg-warnbg rounded-md px-3 py-2">{res.postedSinceFile} TO(s) have been posted with a date after {fmtDate(c.fileDate)}. The app&apos;s kg below is as of now, so those moves can show as gaps.</div>}
      <div className="card overflow-x-auto"><div className="px-4 py-3 border-b border-line font-semibold">2–3 · Fabric × colour × location, biggest gap first</div>
        <table className="tbl"><thead><tr><th>FLAG</th><th>FABRIC #</th><th>CW CODE</th><th>COLOUR</th><th>LOCATION</th><th className="text-right">APP KG</th><th className="text-right">CARBONWORK KG</th><th className="text-right">DIFF</th><th>NOTE</th></tr></thead>
          <tbody>{res.rows.map((r) => (
            <tr key={r.key}><td><span className={`pill ${FLAG[r.flag][1]}`}>{FLAG[r.flag][0]}</span></td><td className="mono">{r.fabricNo}</td><td className="mono text-xs">{r.fabricCode}</td><td>{r.colour}</td><td>{r.location}</td>
              <td className="text-right">{fmtKg(r.sheetG, 1)}</td><td className="text-right">{fmtKg(r.cwG, 1)}</td><td className={`text-right font-semibold ${r.flag !== "OK" ? "text-bad" : ""}`}>{r.diffG > 0 ? "+" : ""}{fmtKg(r.diffG, 1)}</td>
              <td className="text-xs text-muted">{r.note}</td></tr>))}</tbody></table></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-4"><div className="font-semibold mb-2">4 · TO match</div>
          {!tm ? <div className="text-sm text-muted">No ledger file was given.</div> : <div className="grid grid-cols-2 gap-4 text-sm">
            <div><div className="text-xs text-muted mb-1">In Carbonwork, not posted here ({tm.onlyInCarbonwork.length})</div>{tm.onlyInCarbonwork.map((x) => <div key={x} className="mono">{x}</div>)}</div>
            <div><div className="text-xs text-muted mb-1">Posted here, not in Carbonwork ({tm.onlyInSheet.length})</div>{tm.onlyInSheet.map((x) => <Link key={x} href={`/find?q=${x}`} className="mono block underline">{x}</Link>)}</div></div>}
        </div>
        <div className="card p-4 text-sm"><div className="font-semibold mb-2">What a gap usually means</div>
          <ul className="list-disc pl-5 flex flex-col gap-1 text-muted">
            <li><b className="text-ink">Carbonwork higher at a factory</b> — TRO in Zoho but no Transfer TO posted here. Post it if the rolls moved; else correct Zoho.</li>
            <li><b className="text-ink">App higher at storage</b> — consumption posted here but not in Zoho. Enter it in Zoho, tick “Entered in Zoho”.</li>
            <li><b className="text-ink">Negative kg in Carbonwork</b> — a Zoho TRO moved more than was there. Correct in Zoho.</li>
            <li><b className="text-ink">Same totals, different location</b> — wrong source/destination on one side. Reverse and re-post.</li>
            <li><b className="text-ink">Weighed roll differs</b> — weighing error or unrecorded wastage. <Link className="underline" href="/adjustments/new">Adjustment</Link> with reason.</li>
          </ul></div>
      </div>
      <CheckWeigh checkId={c.id} done={c.status === "DONE"} rolls={ws.map(({ w, r, l, k }) => ({ serial: r.serial, location: l.name, rack: k?.code ?? null, sheetG: w.sheetG, weighedG: w.weighedG }))} />
      {c.notes && <div className="text-sm"><b>Notes:</b> {c.notes}</div>}
    </div>
  );
}
