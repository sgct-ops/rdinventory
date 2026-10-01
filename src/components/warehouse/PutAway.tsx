"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScanBox, kg } from "../ScanBox";
import { putAwayAction, checkRackAction } from "@/app/actions";
import type { WCard } from "@/lib/warehouse";

type Waiting = { serial: string; hex: string; why: string };
const G = "oklch(0.62 0.12 150)", W = "oklch(0.8 0.13 80)", Rd = "oklch(0.58 0.17 28)", A = "oklch(0.6 0.16 45)";
const KIND: Record<WCard["kind"], [string, string, string, string]> = {
  return: ["oklch(0.97 0.03 60)", A, A, "↩"], ok: ["#fff", "#e4e1da", G, "✓"], info: ["#fff", "#e4e1da", "#8f8b82", "·"],
  warn: ["oklch(0.97 0.03 85)", W, "oklch(0.7 0.14 75)", "!"], err: ["oklch(0.95 0.03 28)", Rd, Rd, "×"],
};

export function PutAway({ waiting, rackCounts }: { waiting: Waiting[]; rackCounts: Record<string, { n: number; cap: number; room: string }> }) {
  const router = useRouter();
  const [rack, setRack] = useState<string | null>(null);
  const [pendingReturn, setPendingReturn] = useState<string | null>(null);
  const [cards, setCards] = useState<(WCard & { id: number })[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };
  const add = (c: WCard) => setCards((x) => [{ ...c, id: Date.now() + Math.random() }, ...x.filter((y) => !(y.serial === c.serial && (y.kind === "return" || y.action)))]);

  async function place(input: { rackCode: string | null; serial: string; confirm?: "move" | "putBack" }) {
    const r = await putAwayAction(input);
    if (!r.ok) return flash(r.error);
    const c = r.data!;
    if (c.kind === "return") setPendingReturn(c.serial);
    else if (pendingReturn === c.serial) setPendingReturn(null);
    add(c);
    router.refresh();
  }

  async function onScan(code: string) {
    if (code.startsWith("RK-")) {
      const r = await checkRackAction(code);
      if (!r.ok) return flash(r.error);
      setRack(r.data!.code);
      if (pendingReturn) { const s = pendingReturn; setPendingReturn(null); await place({ rackCode: r.data!.code, serial: s }); }
      return;
    }
    await place({ rackCode: pendingReturn ? null : rack, serial: code });
  }

  const placed = cards.filter((c) => c.placed);
  const rc = rack ? rackCounts[rack] : null;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] min-h-[calc(100vh-60px)]">
      <div className="p-5 lg:p-6 flex flex-col gap-4 min-w-0">
        <div className="flex items-center gap-3 flex-wrap"><div className="text-2xl font-semibold">Put away</div>
          <div className="ml-auto text-sm text-muted">New rolls, arrivals and rolls coming back from production</div></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-white rounded-xl px-4 py-3.5 flex items-center gap-3.5 border-[1.5px]" style={{ borderColor: rack ? G : "#1c1b19" }}>
            <div className="w-[30px] h-[30px] rounded-full text-white font-bold flex items-center justify-center flex-none" style={{ background: rack ? G : "#1c1b19" }}>1</div>
            <div><div className="text-[13px] text-muted">Rack</div>
              <div className="mono font-semibold text-xl">{rack ?? "Scan rack label"} <span className="font-sans font-normal text-sm text-muted">{rc ? `${rc.room} · ${rc.n}/${rc.cap}` : ""}</span></div></div>
          </div>
          <div className="bg-white rounded-xl px-4 py-3.5 flex items-center gap-3.5 border-[1.5px]" style={{ borderColor: rack ? "#1c1b19" : "#d6d2c9" }}>
            <div className="w-[30px] h-[30px] rounded-full text-white font-bold flex items-center justify-center flex-none" style={{ background: rack ? "#1c1b19" : "#d6d2c9" }}>2</div>
            <div><div className="text-[13px] text-muted">Rolls</div><div className="text-lg font-semibold">Scan each roll label</div></div>
          </div>
        </div>
        <ScanBox onScan={onScan} placeholder={pendingReturn ? "Scan rack label, or press Put back…" : rack ? `Scan roll for ${rack}…` : "Scan rack label or returning roll…"} />
        <div className="text-[13px] text-muted">
          {pendingReturn ? `${pendingReturn} is waiting: press Put back, or scan a rack label to place it there.`
            : rack ? `Scanning onto ${rack}. Scan a different rack label any time to switch. A new roll's first scan here also activates its label.`
            : "Scan a rack label (RK-…) first. A roll coming back from production can be scanned first: the app offers the rack it left from."}
        </div>
        {toast && <div className="text-sm bg-badbg text-bad rounded-md px-3 py-2">{toast}</div>}
        <div className="flex flex-col gap-2.5">
          {cards.map((c) => {
            const k = KIND[c.kind];
            return (
              <div key={c.id} className="rounded-xl px-4 py-3.5 flex gap-3.5 items-center border-[1.5px] flex-wrap" style={{ background: k[0], borderColor: k[1] }}>
                <div className="w-7 h-7 rounded-full text-white font-bold flex items-center justify-center flex-none" style={{ background: k[2] }}>{k[3]}</div>
                <div className="w-7 h-7 rounded-full border border-black/15 flex-none" style={{ background: c.hex ?? "transparent" }} />
                <div className="flex-1 min-w-[200px]">
                  <div className="mono font-semibold text-base">{c.serial}</div>
                  {c.title && <div className="text-sm text-muted">{c.title}</div>}
                  <div className="text-[13px] mt-0.5">{c.msg}</div>
                  {c.sub && <div className="text-[13px] mt-0.5 font-medium" style={{ color: "oklch(0.45 0.13 45)" }}>{c.sub}</div>}
                  {c.math && (
                    <div className="flex items-baseline gap-2.5 mt-2.5 mono flex-wrap">
                      <div className="text-xl font-semibold">{kg(c.math.beforeG, 1)}</div>
                      <div className="text-base text-muted">− {kg(c.math.minusG, 1)} kg</div>
                      <div className="text-xs text-muted">{c.math.refs}</div>
                      <div className="text-base text-muted">=</div>
                      <div className="text-2xl font-semibold" style={{ color: "oklch(0.45 0.12 150)" }}>{kg(c.math.afterG, 1)} kg</div>
                    </div>
                  )}
                </div>
                {c.kgG !== undefined && <div className="text-lg font-semibold whitespace-nowrap">{kg(c.kgG, 1)} kg</div>}
                {c.action === "move" && rack && <button className="btn h-11" onClick={() => place({ rackCode: rack, serial: c.serial, confirm: "move" })}>Move to {rack}</button>}
                {c.kind === "return" && c.suggestRack && <button className="btn h-11" onClick={() => place({ rackCode: null, serial: c.serial, confirm: "putBack" })}>Put back on {c.suggestRack}</button>}
              </div>
            );
          })}
          {!cards.length && <div className="border-[1.5px] border-dashed border-[#d6d2c9] rounded-xl p-7 text-center text-sm text-muted">Scanned rolls appear here, newest on top</div>}
        </div>
      </div>
      <aside className="bg-white border-l border-line p-6 flex flex-col gap-4">
        <div className="kicker">THIS SESSION</div>
        <div className="flex justify-between items-baseline"><div className="text-[15px] text-muted">Placed</div><div className="text-3xl font-semibold">{placed.length}</div></div>
        <div className="flex justify-between items-baseline"><div className="text-[15px] text-muted">Need attention</div>
          <div className="text-3xl font-semibold">{cards.filter((c) => (c.kind === "warn" && c.action) || c.kind === "err" || c.kind === "return").length}</div></div>
        <div className="flex justify-between items-baseline border-t border-line pt-3.5"><div className="text-[15px] text-muted">Kg placed</div>
          <div className="text-2xl font-semibold">{kg(placed.reduce((a, c) => a + (c.kgG ?? 0), 0), 1)}</div></div>
        <div className="kicker mt-2">WAITING FOR A RACK · {waiting.length}</div>
        <div className="flex flex-col gap-2 overflow-y-auto max-h-[40vh]">
          {waiting.map((u) => (
            <div key={u.serial} className="flex items-center gap-2.5 text-[13px]">
              <div className="w-3.5 h-3.5 rounded-full border border-black/20" style={{ background: u.hex }} />
              <div className="mono font-semibold flex-1">{u.serial}</div><div className="text-muted">{u.why}</div>
            </div>
          ))}
          {!waiting.length && <div className="text-[13px] text-faint">Nothing waiting</div>}
        </div>
        <div className="mt-auto flex flex-col gap-2.5">
          <button className="btn-ghost h-12" onClick={() => { setRack(null); setPendingReturn(null); }}>Change rack</button>
          <button className="btn h-[52px] text-base" onClick={() => router.push("/warehouse")}>Done</button>
        </div>
      </aside>
    </div>
  );
}
