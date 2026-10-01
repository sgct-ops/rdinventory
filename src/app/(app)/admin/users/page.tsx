import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser } from "@/lib/session";
import { fmtDateTime } from "@/lib/units";
import { AdminForm } from "@/components/AdminForm";
import { saveUserAction } from "@/app/admin-actions";

const ROLES = [["ADMIN", "Admin — everything, approvals, masters"], ["INVENTORY", "Inventory — receive, transfer, adjust, racks, spot check"],
  ["MERCHANDISER", "Merchandiser — consumption orders for their style POs"], ["VIEWER", "Viewer — dashboard and find only"]];

export default async function Page() {
  await pageUser(["ADMIN"]);
  const users = await db.select().from(schema.users).orderBy(asc(schema.users.email));
  const locs = await db.select().from(schema.locations).orderBy(asc(schema.locations.name));
  const ul = await db.select().from(schema.userLocations);
  type U = typeof schema.users.$inferSelect;
  const Fields = ({ u }: { u?: U }) => (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr] gap-4">
      {u && <input type="hidden" name="id" value={u.id} />}
      <div className="flex flex-col gap-2">
        <input name="email" defaultValue={u?.email} className="input" placeholder="Google email *" />
        <input name="name" defaultValue={u?.name ?? ""} className="input" placeholder="Name" />
        <select name="role" defaultValue={u?.role ?? "VIEWER"} className="input">{ROLES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <label className="text-sm flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={u ? u.active : true} /> active (may sign in)</label>
        {u && <div className="text-xs text-muted">Last sign-in: {u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "never"}</div>}
      </div>
      <div><div className="label">Locations they may post from</div>
        <label className="text-sm flex items-center gap-2 mb-1"><input type="checkbox" name="allLocations" defaultChecked={u?.allLocations} /> All</label>
        <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">{locs.map((l) => <label key={l.id} className="text-sm flex items-center gap-2"><input type="checkbox" name="locationIds" value={l.id} defaultChecked={!!u && ul.some((x) => x.userId === u.id && x.locationId === l.id)} /> {l.name}</label>)}</div></div>
      <div><div className="label">Style POs (merchandisers)</div>
        <label className="text-sm flex items-center gap-2 mb-1"><input type="checkbox" name="allStylePOs" defaultChecked={u?.allStylePOs} /> All</label>
        <textarea name="stylePOPrefixes" defaultValue={u?.stylePOPrefixes ?? ""} className="input h-24 py-2 mono text-sm" placeholder={"CT26/PO/88, CT26/PO/9"} />
        <div className="text-xs text-muted mt-1">Comma list. Prefixes: CT26/PO/8 allows CT26/PO/8, /80, /88 …</div></div>
    </div>
  );
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-5">
      <div><div className="h1">Users</div><div className="sub">Only people listed here can sign in with Google. Access is checked on every action, not just by hiding buttons.</div></div>
      <AdminForm action={saveUserAction} submit="Add user" className="card p-4"><div className="font-semibold mb-3">Add</div><Fields /></AdminForm>
      {users.map((u) => <AdminForm key={u.id} action={saveUserAction} className={`card p-4 ${u.active ? "" : "opacity-60"}`}><Fields u={u} /></AdminForm>)}
    </div>
  );
}
