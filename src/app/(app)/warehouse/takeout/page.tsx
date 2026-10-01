import { pageUser, NAV_ROLES } from "@/lib/session";
import { takenOutList } from "@/lib/floor";
import { TakeOut } from "@/components/warehouse/TakeOut";
import { DataTable, type Col, type Row } from "@/components/DataTable";

export default async function Page() {
  await pageUser(NAV_ROLES.takeOut);
  const list = await takenOutList();
  const cols: Col[] = [
    { key: "serial", label: "ROLL", kind: "mono", href: "_href" },
    { key: "fabric", label: "FABRIC", wide: true },
    { key: "kg", label: "KG LEFT", kind: "kg", total: true },
    { key: "purpose", label: "FOR", kind: "pill", tone: "tone", filter: true },
    { key: "po", label: "STYLE PO", kind: "mono", filter: true },
    { key: "at", label: "TAKEN OUT", kind: "datetime" },
    { key: "by", label: "BY", filter: true },
    { key: "trocs", label: "TROC MADE", kind: "mono" },
    { key: "rack", label: "CAME FROM", kind: "mono" },
    { key: "invoice", label: "INVOICE", kind: "mono", hidden: true },
  ];
  const rows: Row[] = list.map((r) => ({
    _id: r.serial, _href: `/rolls/${r.serial}`, serial: r.serial, fabric: `${r.fabric_no} · ${r.item_name}${r.colour ? ` · ${r.colour}` : ""}`, kg: r.remaining_g,
    purpose: r.taken_out_purpose === "SAMPLING" ? "Sampling" : "Production", tone: r.taken_out_purpose === "SAMPLING" ? "info" : "warn", po: r.taken_out_for,
    at: r.taken_out_at, by: String(r.taken_out_by ?? "").split("@")[0], trocs: r.trocs ?? "— not yet", rack: r.last_rack, invoice: r.invoice_no,
  }));
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-5 min-w-0 max-w-6xl">
      <div><span className="pill bg-warnbg text-amber-800 font-semibold">TAKE OUT</span><div className="h1 mt-2">Take out for production</div>
        <div className="sub max-w-2xl">Before cutting: scan each roll as it leaves the rack. It comes off the rack and is marked “taken out” for the style PO. The TROC is made later from these rolls. Leftover rolls go back with Put away.</div></div>
      <TakeOut />
      <div className="font-semibold mt-2">Out on the floor now</div>
      <DataTable id="takenout" cols={cols} rows={rows} csvName="taken-out" empty="No rolls are taken out." />
    </div>
  );
}
