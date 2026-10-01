import { asc, ilike, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageUser } from "@/lib/session";
import { fabricHex } from "@/lib/warehouse";
import { AdminForm } from "@/components/AdminForm";
import { saveFabricAction, importFabricsAction } from "@/app/admin-actions";

const GRID = "16px 1.6fr 1.1fr .8fr .8fr 1fr .8fr .7fr 50px minmax(160px,auto)";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; missing?: string }> }) {
  await pageUser(["ADMIN"]);
  const { q, missing } = await searchParams;
  let rows = await db.select().from(schema.fabricItems).where(q ? or(ilike(schema.fabricItems.itemName, `%${q}%`), ilike(schema.fabricItems.fabricNo, `%${q}%`), ilike(schema.fabricItems.cwFabricCode, `%${q}%`), ilike(schema.fabricItems.colour, `%${q}%`)) : undefined)
    .orderBy(asc(schema.fabricItems.fabricNo), asc(schema.fabricItems.itemName));
  if (missing) rows = rows.filter((r) => !r.fabricNo || !r.cwFabricCode);
  const noNo = rows.filter((r) => !r.fabricNo).length;
  return (
    <div className="p-5 lg:p-7 flex flex-col gap-5">
      <div><div className="h1">Fabric inventory</div><div className="sub">Master list · one row per fabric × colour. Fill the Rajdanga Fabric # (unique; used in serials) and the Carbonwork code + colour (used by the check). {noNo} without a Fabric #.</div></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AdminForm action={importFabricsAction} submit="Import" className="card p-4">
          <div className="font-semibold mb-1">Import from Zoho (items CSV)</div>
          <div className="text-xs text-muted mb-2">Columns used: Item ID, SKU, Item Name, Group Name, Unit, Vendor, and optionally Carbonwork fabric code, Colour, Rajdanga Fabric #. Upserts by Item ID; never overwrites a Fabric # already set.</div>
          <input type="file" name="file" accept=".csv" className="text-sm" />
        </AdminForm>
        <AdminForm action={saveFabricAction} submit="Add fabric" className="card p-4">
          <div className="font-semibold mb-2">Add one</div>
          <div className="grid grid-cols-2 gap-2">
            <input name="itemName" className="input" placeholder="Item name *" /><input name="fabricNo" className="input mono" placeholder="Rajdanga Fabric #" />
            <input name="cwFabricCode" className="input" placeholder="Carbonwork code" /><input name="colour" className="input" placeholder="Colour" />
            <input name="sku" className="input" placeholder="SKU" /><input name="zohoItemId" className="input" placeholder="Zoho item id" />
          </div>
        </AdminForm>
      </div>
      <form className="flex gap-2 flex-wrap"><input name="q" defaultValue={q} className="input w-64 max-w-full" placeholder="Search…" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="missing" defaultChecked={!!missing} /> only missing Fabric # / CW code</label><button className="btn-ghost">Filter</button></form>
      <div className="card overflow-x-auto">
        <div className="min-w-[1100px]">
          <div className="grid gap-2 px-3 py-2.5 border-b border-line kicker" style={{ gridTemplateColumns: GRID }}>
            <div /><div>ITEM</div><div>ZOHO ID · SKU · VENDOR</div><div>GROUP</div><div>CW CODE</div><div>COLOUR</div><div>FABRIC #</div><div>SWATCH</div><div>ACTIVE</div><div />
          </div>
          {rows.map((f) => (
            <AdminForm key={f.id} action={saveFabricAction} inline submit="Save" className="grid gap-2 items-center px-3 py-2 border-b border-line2" style={{ gridTemplateColumns: GRID }}>
              <input type="hidden" name="id" value={f.id} />
              <input type="hidden" name="zohoItemId" value={f.zohoItemId ?? ""} /><input type="hidden" name="sku" value={f.sku ?? ""} />
              <input type="hidden" name="vendor" value={f.vendor ?? ""} /><input type="hidden" name="unit" value={f.unit} />
              <div className="w-3.5 h-3.5 rounded-full border border-black/20" style={{ background: fabricHex(f.hex, f.colour, f.id) }} />
              <input name="itemName" defaultValue={f.itemName} className="input h-8" />
              <div className="text-xs text-muted truncate" title={`${f.zohoItemId ?? ""} · ${f.sku ?? ""} · ${f.vendor ?? ""}`}>{f.zohoItemId ?? "—"} · {f.sku ?? "—"}<br />{f.vendor ?? ""} {f.unit}</div>
              <input name="group" defaultValue={f.group ?? ""} className="input h-8" />
              <input name="cwFabricCode" defaultValue={f.cwFabricCode ?? ""} className="input h-8" placeholder="CW code" />
              <input name="colour" defaultValue={f.colour ?? ""} className="input h-8" placeholder="Colour" />
              <input name="fabricNo" defaultValue={f.fabricNo ?? ""} className={`input h-8 mono ${f.fabricNo ? "" : "border-warn"}`} placeholder="Fabric #" />
              <input name="hex" defaultValue={f.hex ?? ""} className="input h-8 mono" placeholder="#hex" />
              <div><input type="hidden" name="active" value="off" /><input type="checkbox" name="active" defaultChecked={f.active} aria-label="active" /></div>
            </AdminForm>))}
          {!rows.length && <div className="text-center text-muted py-6">No fabrics — import the Zoho items CSV</div>}
        </div>
      </div>
    </div>
  );
}
