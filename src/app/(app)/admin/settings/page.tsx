import { pageUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { AdminForm } from "@/components/AdminForm";
import { saveSettingsAction } from "@/app/admin-actions";

export default async function Page() {
  await pageUser(["ADMIN"]);
  const s = await getSettings();
  const F = ({ k, label, help }: { k: keyof typeof s; label: string; help?: string }) => (
    <div><label className="label">{label}</label><input name={k} defaultValue={s[k]} className="input" />{help && <div className="text-xs text-faint mt-1">{help}</div>}</div>
  );
  return (
    <div className="p-5 lg:p-7 flex flex-col gap-5 max-w-3xl">
      <div><div className="h1">Settings</div></div>
      <AdminForm action={saveSettingsAction} className="card p-5 flex flex-col gap-5">
        <div className="font-semibold">Adjustment approval</div>
        <div className="grid grid-cols-3 gap-3">
          <F k="adjLimitKg" label="Limit kg" /><F k="adjLimitPct" label="Limit % of roll (weighed kg)" />
          <div><label className="label">Needs approval above</label><select name="adjLimitRule" defaultValue={s.adjLimitRule} className="input"><option value="SMALLER">the smaller of the two</option><option value="LARGER">the larger of the two</option></select></div>
        </div>
        <div className="font-semibold">Labels</div>
        <div className="grid grid-cols-3 gap-3"><F k="labelWidthMm" label="Label width mm" /><F k="labelHeightMm" label="Label height mm" /><F k="labelDpi" label="Printer dpi (TSC: 203 or 300)" /></div>
        <div className="font-semibold">Consumption</div>
        <F k="orderNumberPattern" label="Order number format (regular expression)" help="Default accepts #1234, internal numbers and STOCK. Shopify only: ^(#\d{3,}|STOCK)$" />
        <F k="undoMinutes" label="Undo allowed within (minutes)" />
        <div className="font-semibold">Carbonwork check</div>
        <div className="grid grid-cols-3 gap-3"><F k="checkTolKg" label="OK within ± kg" /><F k="checkTolPct" label="or within %" /><F k="spotCheckRolls" label="Rolls picked to weigh" /></div>
        <div className="font-semibold">Dashboard &amp; warehouse</div>
        <div className="grid grid-cols-3 gap-3"><F k="lowStockKg" label="Amber under kg" /><F k="rackFullPct" label="Rack shows full at %" /></div>
      </AdminForm>
    </div>
  );
}
