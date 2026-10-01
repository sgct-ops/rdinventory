import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser } from "@/lib/session";
import { AdminForm } from "@/components/AdminForm";
import { saveLocationAction, importLocationsAction } from "@/app/admin-actions";

const TYPES = ["STORAGE", "PRODUCTION", "FACTORY", "VENDOR", "OFFICE"];
function Fields({ l }: { l?: typeof schema.locations.$inferSelect }) {
  return (<>
    {l && <input type="hidden" name="id" value={l.id} />}
    <input name="code" defaultValue={l?.code} className="input h-8 w-28 mono" placeholder="Code *" />
    <input name="name" defaultValue={l?.name} className="input h-8 w-44" placeholder="Name *" />
    <select name="type" defaultValue={l?.type ?? "STORAGE"} className="input h-8 w-32">{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
    <input name="address" defaultValue={l?.address ?? ""} className="input h-8 w-56" placeholder="Address" />
    <input name="zohoLocationId" defaultValue={l?.zohoLocationId ?? ""} className="input h-8 w-32" placeholder="Zoho location id" />
    <input name="contact" defaultValue={l?.contact ?? ""} className="input h-8 w-32" placeholder="Contact" />
    <input name="carbonworkName" defaultValue={l?.carbonworkName ?? ""} className="input h-8 w-40" placeholder="Name in Carbonwork" />
    {l && <><input type="hidden" name="active" value="off" /><label className="text-xs flex items-center gap-1"><input type="checkbox" name="active" defaultChecked={l.active} /> active</label></>}
  </>);
}
export default async function Page() {
  await pageUser(["ADMIN"]);
  const rows = await db.select().from(schema.locations).orderBy(asc(schema.locations.name));
  return (
    <div className="p-5 lg:p-7 flex flex-col gap-5">
      <div><div className="h1">Locations</div><div className="sub">Storage, factory, production and vendor locations. “Name in Carbonwork” is used when Carbonwork spells it differently.</div></div>
      <AdminForm action={importLocationsAction} submit="Import" className="card p-4 max-w-2xl">
        <div className="font-semibold mb-1">Import from Zoho (locations / warehouses CSV)</div>
        <input type="file" name="file" accept=".csv" className="text-sm" />
      </AdminForm>
      <div className="card p-4"><div className="font-semibold mb-2">Add</div><AdminForm action={saveLocationAction} inline submit="Add" className="flex gap-2 flex-wrap items-center"><Fields /></AdminForm></div>
      <div className="card divide-y divide-line2">{rows.map((l) => (
        <AdminForm key={l.id} action={saveLocationAction} inline className="flex gap-2 flex-wrap items-center px-3 py-2"><Fields l={l} /></AdminForm>))}</div>
    </div>
  );
}
