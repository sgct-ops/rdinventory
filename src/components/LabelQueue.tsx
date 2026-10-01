"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { markLabelsPrintedAction } from "@/app/actions";

type Row = { id: string; serial: string; fabric: string; batch: string; kg: string; registered: string; printed: boolean; location: string; cut: string };

export function LabelQueue({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set(rows.filter((r) => !r.printed).map((r) => r.id)));
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function print() {
    const ids = [...sel];
    // open the PDF first (inside the click, so pop-up blockers allow it), then mark printed
    window.open(`/api/labels/rolls?ids=${ids.join(",")}`, "_blank");
    const r = await markLabelsPrintedAction(ids);
    setMsg(r.ok ? `${r.data} label(s) in the PDF. They stay here until each one is scanned in.` : r.error);
    router.refresh();
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn" disabled={!sel.size} onClick={print}>Make labels PDF ({sel.size})</button>
        <button className="btn-ghost btn-sm" onClick={() => setSel(new Set(rows.map((r) => r.id)))}>Select all</button>
        <button className="btn-ghost btn-sm" onClick={() => setSel(new Set())}>Clear</button>
        {msg && <div className="text-sm">{msg}</div>}
      </div>
      <div className="card overflow-x-auto"><table className="tbl">
        <thead><tr><th></th><th>SERIAL</th><th>FABRIC</th><th>BATCH</th><th className="text-right">KG</th><th>REGISTERED</th><th>AT</th><th>LABEL</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} onClick={() => toggle(r.id)} className="cursor-pointer">
            <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
            <td className="mono font-medium">{r.serial}</td><td>{r.fabric}</td><td className="mono text-xs text-muted">{r.batch}</td>
            <td className="text-right">{r.kg}</td><td className="text-muted">{r.registered}</td><td className="text-muted">{r.location}</td>
            <td>{r.printed ? <span className="pill bg-chip">printed · not scanned</span> : <span className="pill bg-warnbg">to print</span>}{r.cut && <span className="pill bg-[#eaf1fb] ml-1">{r.cut}</span>}</td></tr>))}
          {!rows.length && <tr><td colSpan={8} className="text-center text-muted py-6">Label queue is empty</td></tr>}</tbody></table></div>
    </div>
  );
}
