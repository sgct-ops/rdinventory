import Link from "next/link";
import { pageUser, NAV_ROLES } from "@/lib/session";
import { listPOs, poSummary } from "@/lib/purchasing";
import { fabricOptions } from "@/lib/queries";
import { fmtKg, fmtDate } from "@/lib/units";
import { DataTable, type Col, type Row } from "@/components/DataTable";
import { POEditor, POStatusButton } from "@/components/POEditor";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; new?: string }> }) {
  const u = await pageUser(NAV_ROLES.pos);
  const sp = await searchParams;
  const canEdit = NAV_ROLES.editPOs.includes(u.role);
  const [list, fabrics, one] = await Promise.all([listPOs(), canEdit ? fabricOptions() : Promise.resolve([]), sp.q ? poSummary(sp.q) : Promise.resolve(null)]);
  const cols: Col[] = [
    { key: "po", label: "PO", kind: "mono", href: "_href" },
    { key: "vendor", label: "VENDOR", filter: true },
    { key: "fabrics", label: "FABRICS", kind: "mono", wide: true },
    { key: "expected", label: "EXPECTED", kind: "kg1", total: true },
    { key: "received", label: "RECEIVED", kind: "kg1", total: true },
    { key: "left", label: "STILL TO COME", kind: "kg1", total: true },
    { key: "receipts", label: "RECEIPTS", kind: "num" },
    { key: "last", label: "LAST RECEIVED", kind: "date" },
    { key: "state", label: "STATE", kind: "pill", tone: "tone", filter: true },
    { key: "source", label: "FROM", filter: true, hidden: true },
  ];
  const rows: Row[] = list.map((p) => {
    const left = p.lines.reduce((a, l) => a + l.leftG, 0);
    const state = p.status === "CLOSED" ? "Closed" : p.receivedG === 0 ? "Not started" : left <= 0 ? "All received" : "Part received";
    return { _id: p.id, _href: `/pos?q=${encodeURIComponent(p.poNumber)}`, po: p.poNumber, vendor: p.vendor, fabrics: p.lines.map((l) => l.fabricNo).join(", "),
      expected: p.expectedG, received: p.receivedG, left, receipts: p.receiptCount, last: p.lastReceipt, state, source: p.source,
      tone: state === "Closed" ? "muted" : state === "All received" ? "ok" : state === "Part received" ? "warn" : "info" };
  });
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-5 min-w-0">
      <div><div className="h1">Incoming POs</div><div className="sub">What each fabric PO brings and how much has come. Receiving checks every fabric against this. A PO can arrive in several parts.</div></div>
      {one && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-3 flex-wrap px-5 py-4 border-b border-line">
            <div className="mono text-xl font-semibold">{one.poNumber}</div>{one.vendor && <div className="text-muted">{one.vendor}</div>}
            <span className={`pill ${one.status === "CLOSED" ? "bg-chip" : "bg-okbg text-ok"}`}>{one.status === "CLOSED" ? "Closed" : "Open"}</span>
            <div className="ml-auto flex gap-2">{canEdit && <POStatusButton id={one.id} status={one.status} />}{NAV_ROLES.register.includes(u.role) && one.status === "OPEN" && <Link className="btn btn-sm" href="/receive">Receive</Link>}</div>
          </div>
          <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>FABRIC #</th><th>SKU</th><th>ITEM</th><th className="text-right">EXPECTED</th><th className="text-right">RECEIVED</th><th className="text-right">ROLLS</th><th className="text-right">STILL TO COME</th></tr></thead>
            <tbody>{one.lines.map((l) => <tr key={l.id}><td className="mono font-medium">{l.fabricNo}</td><td className="mono text-xs">{l.sku}</td><td>{l.item}</td><td className="text-right">{fmtKg(l.expectedG, 1)}</td>
              <td className="text-right">{fmtKg(l.receivedG, 1)}</td><td className="text-right">{l.receivedRolls}{l.expectedRolls ? ` / ${l.expectedRolls}` : ""}</td><td className={`text-right font-semibold ${l.done ? "text-ok" : ""}`}>{l.done ? "✓" : fmtKg(l.leftG, 1)}</td></tr>)}</tbody></table></div>
          <div className="px-5 py-3 border-t border-line text-sm"><b>Receipts:</b> {one.receipts.length ? one.receipts.map((r) => <span key={r.number} className="mr-4"><span className="mono">{r.number}</span> · {fmtDate(r.date)} · invoice <Link className="mono underline" href={`/invoices/${encodeURIComponent(r.invoiceNo)}`}>{r.invoiceNo}</Link> · {r.rolls} rolls · {fmtKg(r.kgG, 1)} kg</span>) : "none yet"}</div>
        </div>)}
      {sp.q && !one && <div className="card p-4 text-sm"><b>{sp.q.toUpperCase()}</b> isn&apos;t in Incoming POs yet.{canEdit ? " Add it below." : ""}</div>}
      {canEdit && <POEditor fabrics={fabrics.map((f) => ({ id: f.id, fabricNo: f.fabricNo, sku: f.sku, label: f.label }))} initialPO={sp.new ?? (sp.q && !one ? sp.q.toUpperCase() : undefined)}
        initial={one ? { vendor: one.vendor, expectedDate: one.expectedDate, lines: one.lines.map((l) => ({ item: l.fabricNo ?? "", kg: String(l.expectedG / 1000), rolls: l.expectedRolls ? String(l.expectedRolls) : "" })) } : undefined} />}
      <DataTable id="pos" cols={cols} rows={rows} csvName="incoming-pos" empty="No incoming POs yet. Add one above or import from Zoho / Carbonwork." />
    </div>
  );
}
