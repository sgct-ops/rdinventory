import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser } from "@/lib/session";
import { AdminForm } from "@/components/AdminForm";
import { saveRackAction } from "@/app/admin-actions";

export default async function Page() {
  await pageUser(["ADMIN"]);
  const locs = await db.select().from(schema.locations).where(eq(schema.locations.active, true)).orderBy(asc(schema.locations.name));
  const rows = await db.select({ r: schema.racks, n: sql<number>`(select count(*)::int from rolls rr where rr.rack_id = "racks"."id")` }).from(schema.racks).orderBy(asc(schema.racks.sortOrder), asc(schema.racks.code));
  const Fields = ({ r }: { r?: typeof schema.racks.$inferSelect }) => (<>
    {r && <input type="hidden" name="id" value={r.id} />}
    <input name="code" defaultValue={r?.code} className="input h-8 w-24 mono" placeholder="R1-A" />
    <select name="locationId" defaultValue={r?.locationId ?? locs.find((l) => l.type === "STORAGE")?.id} className="input h-8 w-44">{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
    <input name="building" defaultValue={r?.building} className="input h-8 w-40" placeholder="Storage Building" />
    <input name="room" defaultValue={r?.room} className="input h-8 w-28" placeholder="Room 1" />
    <input name="capacity" defaultValue={r?.capacity ?? 48} className="input h-8 w-20" placeholder="48" title="Capacity (rolls)" />
    <input name="sortOrder" defaultValue={r?.sortOrder ?? 0} className="input h-8 w-16" title="Sort order" />
    {r && <><input type="hidden" name="active" value="off" /><label className="text-xs flex items-center gap-1"><input type="checkbox" name="active" defaultChecked={r.active} /> active</label></>}
  </>);
  return (
    <div className="p-5 lg:p-7 flex flex-col gap-5">
      <div className="flex items-end gap-3 flex-wrap"><div><div className="h1">Racks</div><div className="sub">Racks inside a location. Their labels read RK-&lt;code&gt;. The map groups them by building, then room, in sort order.</div></div>
        <a className="btn-ghost ml-auto" href="/api/labels/racks" target="_blank">Print all rack labels</a></div>
      <div className="card p-4"><div className="font-semibold mb-2">Add rack · code · location · building · room · capacity · sort</div>
        <AdminForm action={saveRackAction} inline submit="Add" className="flex gap-2 flex-wrap items-center"><Fields /></AdminForm></div>
      <div className="card divide-y divide-line2">{rows.map(({ r, n }) => (
        <AdminForm key={r.id} action={saveRackAction} inline className="flex gap-2 flex-wrap items-center px-3 py-2"><Fields r={r} /><span className="text-xs text-muted">{n} rolls</span></AdminForm>))}
        {!rows.length && <div className="p-6 text-center text-muted">No racks yet</div>}</div>
    </div>
  );
}
