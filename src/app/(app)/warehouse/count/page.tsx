import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser, NAV_ROLES } from "@/lib/session";
import { fmtDateTime } from "@/lib/units";
import { CountView, type CountState } from "@/components/warehouse/CountView";

type Details = { found: string[]; unexpected: string[]; fixed: string[]; missing?: string[]; cancelled?: boolean };

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string; rack?: string }> }) {
  await pageUser(NAV_ROLES.activate);
  const sp = await searchParams;
  const racks = (await db.select({ code: schema.racks.code }).from(schema.racks).where(eq(schema.racks.active, true)).orderBy(asc(schema.racks.sortOrder), asc(schema.racks.code))).map((r) => r.code);
  let state: CountState | null = null;
  if (sp.id) {
    const [c] = await db.select().from(schema.rackCounts).where(eq(schema.rackCounts.id, sp.id));
    const d = c?.details as Details | undefined;
    if (c && d && !d.cancelled) {
      const [rack] = await db.select().from(schema.racks).where(eq(schema.racks.id, c.rackId));
      const onRack = await db.select().from(schema.rolls).where(eq(schema.rolls.rackId, rack.id));
      const all = await db.select({ serial: schema.rolls.serial, remainingG: schema.rolls.remainingG, rackId: schema.rolls.rackId, status: schema.rolls.status })
        .from(schema.rolls);
      const bySerial = new Map(all.map((r) => [r.serial, r]));
      const rackCodes = new Map((await db.select().from(schema.racks)).map((r) => [r.id, r.code]));
      state = {
        countId: c.id, rack: rack.code, room: `${rack.room} · ${rack.building}`, started: fmtDateTime(c.startedAt),
        found: d.found.map((s) => ({ serial: s, remainingG: bySerial.get(s)?.remainingG ?? 0 })),
        notYet: onRack.filter((r) => !d.found.includes(r.serial)).map((r) => ({ serial: r.serial, remainingG: r.remainingG })),
        unexpected: d.unexpected.map((s) => { const r = bySerial.get(s); return { serial: s, map: r?.rackId ? rackCodes.get(r.rackId) ?? "?" : r?.status === "FINISHED" ? "Finished" : "not on a rack" }; }),
        done: c.finishedAt ? { gaps: c.gaps, missing: d.missing ?? [] } : null,
      };
    }
  }
  return <CountView state={state} racks={racks} autoStart={!sp.id && sp.rack && racks.includes(sp.rack) ? sp.rack : undefined} />;
}
