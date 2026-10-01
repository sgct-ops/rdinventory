"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScanBox, kg, beep } from "./ScanBox";
import { lookupActivateAction, activateLabelsAction } from "@/app/actions";

type Q = { serial: string; fabric: string; kgG: number; location: string; cut: boolean };
type Card = { serial: string; ok: boolean; text: string };

/** Scan each label after it is stuck on; then activate them together (like the sheet). */
export function ActivateLabels({ queue }: { queue: Q[] }) {
  const router = useRouter();
  const [cards, setCards] = useState<Card[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const done = new Set(cards.filter((c) => c.ok).map((c) => c.serial));
  async function onScan(code: string) {
    if (cards.some((c) => c.serial === code)) { beep(false); setMsg({ ok: false, t: `${code} is already scanned.` }); return; }
    const r = await lookupActivateAction(code);
    const x = r.ok ? (r.data as { ok: boolean; error?: string; fabricNo?: string; fabric?: string; colour?: string; batch?: string; remainingG?: number; location?: string }) : { ok: false, error: r.error };
    beep(!!x.ok);
    setCards((c) => [{ serial: code, ok: !!x.ok, text: x.ok ? `${x.fabricNo} · ${x.fabric} ${x.colour ?? ""} · ${x.batch} · ${kg(x.remainingG, 1)} kg at ${x.location}` : x.error ?? "" }, ...c]);
  }
  async function activate() {
    if (cards.some((c) => !c.ok)) { setMsg({ ok: false, t: "Remove the red rows first." }); beep(false); return; }
    if (!cards.length) { setMsg({ ok: false, t: "Scan at least one label." }); return; }
    setBusy(true);
    const r = await activateLabelsAction(cards.map((c) => c.serial));
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, t: r.error });
    setMsg({ ok: true, t: `${r.data} label${r.data === 1 ? "" : "s"} activated. Those rolls are In stock.` });
    setCards([]); router.refresh();
  }
  return (
    <div className="min-h-[calc(100vh-60px)] flex flex-col">
      <div className="p-4 lg:p-7 flex flex-col gap-4 max-w-4xl w-full mx-auto flex-1">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1"><span className="pill bg-[#eaf1fb] text-[#2459a8] font-semibold">LABELS</span><div className="h1 mt-2">Activate labels</div>
            <div className="sub">Scan each label after it is stuck on its roll. New rolls turn In stock; the label leaves the print queue. At Rajdanga Storage the put-away scan does this for you.</div></div>
          <div className="text-right"><div className="kicker">SCANNED</div><div className="text-2xl font-semibold">{done.size} / {queue.length}</div></div>
        </div>
        <ScanBox onScan={onScan} placeholder="Scan a roll serial…" />
        {msg && <div className={`text-sm rounded-md px-3 py-2 ${msg.ok ? "bg-okbg" : "bg-badbg text-bad"}`}>{msg.t}</div>}
        {cards.map((c) => (
          <div key={c.serial} className={`rounded-xl border-[1.5px] px-4 py-3 flex items-center gap-3 ${c.ok ? "border-[#c5e3d1] bg-[#f7fcf9]" : "border-bad bg-badbg"}`}>
            <div className={`w-8 h-8 rounded-full font-bold grid place-items-center ${c.ok ? "bg-okbg text-ok" : "bg-[#fbd9d1] text-bad"}`}>{c.ok ? "✓" : "!"}</div>
            <div className="flex-1 min-w-0"><div className="mono font-semibold">{c.serial}</div><div className="text-sm text-muted">{c.text}</div></div>
            <button className="text-faint text-xl hover:text-bad" onClick={() => setCards((x) => x.filter((y) => y.serial !== c.serial))}>×</button>
          </div>))}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-line font-semibold">Waiting for a scan <span className="text-muted font-normal text-sm">· every label not scanned in yet</span></div>
          <div className="max-h-[340px] overflow-y-auto">
            {queue.map((q) => (
              <div key={q.serial} className={`grid grid-cols-[150px_1fr_auto] gap-3 px-4 py-2.5 border-b border-line2 text-[13px] items-center ${done.has(q.serial) ? "bg-[#f7fcf9]" : ""}`}>
                <b className="mono">{q.serial}</b><span className="text-muted truncate">{q.fabric} · {kg(q.kgG, 1)} kg · {q.location}{q.cut ? " · cut piece" : ""}</span>
                <span className={done.has(q.serial) ? "text-ok font-semibold" : "text-faint"}>{done.has(q.serial) ? "✓ scanned" : "waiting"}</span>
              </div>))}
            {!queue.length && <div className="p-6 text-center text-muted text-sm">No labels are waiting. Everything is scanned in.</div>}
          </div>
        </div>
      </div>
      <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-line px-4 lg:px-7 py-3 flex gap-2 justify-end">
        <button className="btn-ghost" onClick={() => setCards((c) => c.slice(1))}>Undo last</button>
        <button className="btn h-12 px-6" disabled={busy} onClick={activate}>Activate scanned labels ({cards.length})</button>
      </div>
    </div>
  );
}
