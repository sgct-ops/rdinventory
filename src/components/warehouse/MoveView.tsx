"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScanBox, kg } from "../ScanBox";
import { moveAction, checkRackAction } from "@/app/actions";
import type { WCard } from "@/lib/warehouse";

type Row = { serial: string; hex: string; fab: string; remainingG: number };
const G = "oklch(0.62 0.12 150)", W = "oklch(0.8 0.13 80)", Rd = "oklch(0.58 0.17 28)";
const K = { ok: ["#fff", "#e4e1da", G, "✓"], info: ["#fff", "#e4e1da", "#8f8b82", "·"], warn: ["oklch(0.97 0.03 85)", W, "oklch(0.7 0.14 75)", "!"], err: ["oklch(0.95 0.03 28)", Rd, Rd, "×"], return: ["#fff", "#e4e1da", G, "✓"] } as const;

export function MoveView(p: { from: string | null; to: string | null; fromList: Row[]; toList: Row[]; meta: Record<string, { n: number; cap: number; room: string }> }) {
  const router = useRouter();
  const [cards, setCards] = useState<(WCard & { id: number; t: string })[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };
  const go = (from: string | null, to: string | null) => {
    const q = new URLSearchParams(); if (from) q.set("from", from); if (to) q.set("to", to);
    router.replace(`/warehouse/move${q.size ? "?" + q : ""}`);
  };
  const moved = new Set(cards.filter((c) => c.placed).map((c) => c.serial));

  async function onScan(code: string) {
    if (code.startsWith("RK-")) {
      const r = await checkRackAction(code);
      if (!r.ok) return flash(r.error);
      const c = r.data!.code;
      if (!p.from) return go(c, null);
      if (!p.to) return c === p.from ? flash("The destination must be a different rack") : go(p.from, c);
      return flash(`Moving ${p.from} → ${p.to}. Press Change racks to start again.`);
    }
    if (!p.from || !p.to) return flash("Scan the two rack labels first: from, then to");
    const r = await moveAction({ from: p.from, to: p.to, serial: code });
    if (!r.ok) return flash(r.error);
    setCards((x) => [{ ...r.data!, id: Date.now(), t: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) }, ...x]);
    router.refresh();
  }
  const step = (on: boolean, done: boolean) => (done ? G : on ? "#1c1b19" : "#d6d2c9");
  const Box = ({ n, on, done, label, txt, sub }: { n: number; on: boolean; done: boolean; label: string; txt: string; sub: string }) => (
    <div className="bg-white rounded-xl px-4 py-3.5 flex items-center gap-3.5 border-[1.5px]" style={{ borderColor: step(on, done) }}>
      <div className="w-[30px] h-[30px] rounded-full text-white font-bold flex items-center justify-center flex-none" style={{ background: step(on, done) }}>{n}</div>
      <div className="min-w-0"><div className="text-[13px] text-muted">{label}</div>
        <div className="mono font-semibold text-[19px] whitespace-nowrap">{txt} <span className="font-sans font-normal text-[13px] text-muted">{sub}</span></div></div>
    </div>
  );
  const List = ({ rows, hi }: { rows: Row[]; hi?: boolean }) => rows.map((r) => (
    <div key={r.serial} className="flex items-center gap-3 px-4 py-2.5 border-b border-line2 text-[13px]" style={{ background: hi ? "oklch(0.985 0.015 60)" : "#fff" }}>
      <div className="w-3.5 h-3.5 rounded-full border border-black/20 flex-none" style={{ background: r.hex }} />
      <div className="mono w-[120px]">{r.serial}</div><div className="flex-1 text-muted min-w-0 truncate">{r.fab}</div><div className="font-semibold">{kg(r.remainingG, 1)} kg</div>
    </div>
  ));
  const mf = p.from ? p.meta[p.from] : null, mt = p.to ? p.meta[p.to] : null;
  return (
    <div className="flex flex-col px-5 lg:px-7 py-6 gap-4 min-h-[calc(100vh-60px)]">
      <div className="flex items-center gap-3.5 flex-wrap"><div className="h1">Move rolls</div>
        <div className="text-[13px] text-muted">Scan the rack they leave, the rack they go to, then each roll. Each roll moves when it is scanned. Rack update only, no TO.</div>
        <button className="btn-ghost ml-auto" onClick={() => { setCards([]); go(null, null); }}>Change racks</button></div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Box n={1} on={!p.from} done={!!p.from} label="From rack" txt={p.from ?? "Scan rack label"} sub={mf ? `${mf.room} · ${mf.n}/${mf.cap}` : ""} />
        <Box n={2} on={!!p.from && !p.to} done={!!p.to} label="To rack" txt={p.to ?? (p.from ? "Scan rack label" : "—")} sub={mt ? `${mt.room} · ${mt.n}/${mt.cap}` : ""} />
        <Box n={3} on={!!p.from && !!p.to} done={false} label="Rolls" txt={p.from && p.to ? `${moved.size} moved` : "—"} sub={p.from && p.to ? "scan each roll" : ""} />
      </div>
      <ScanBox onScan={onScan} placeholder={!p.from ? "Scan the rack rolls leave…" : !p.to ? "Scan the rack they go to…" : `Scan rolls ${p.from} → ${p.to}…`} />
      {toast && <div className="text-sm bg-badbg text-bad rounded-md px-3 py-2">{toast}</div>}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_1.15fr_1fr] gap-4 min-h-0">
        <div className="card flex flex-col overflow-hidden"><div className="px-4 py-3 border-b border-line kicker">STILL ON {p.from ?? "—"} · {p.fromList.length}</div>
          <div className="flex-1 overflow-y-auto max-h-[60vh]"><List rows={p.fromList} /></div></div>
        <div className="flex flex-col gap-2.5 overflow-y-auto max-h-[65vh]">
          {cards.map((c) => { const k = K[c.kind]; return (
            <div key={c.id} className="rounded-xl px-3.5 py-3 flex gap-3 items-center border-[1.5px]" style={{ background: k[0], borderColor: k[1] }}>
              <div className="w-[26px] h-[26px] rounded-full text-white font-bold flex items-center justify-center flex-none" style={{ background: k[2] }}>{k[3]}</div>
              <div className="flex-1 min-w-0"><div className="mono font-semibold">{c.serial}</div><div className="text-[13px] mt-0.5">{c.msg}</div></div>
              <div className="mono text-xs text-muted">{c.t}</div>
            </div>); })}
          {!cards.length && <div className="border-[1.5px] border-dashed border-[#d6d2c9] rounded-xl p-7 text-center text-sm text-muted">
            {!p.from ? "Scan the label of the rack the rolls are leaving" : !p.to ? "Now scan the label of the rack they are going to" : `Scan each roll as it goes from ${p.from} to ${p.to}`}</div>}
        </div>
        <div className="bg-white rounded-[10px] flex flex-col overflow-hidden border-[1.5px] border-accent"><div className="px-4 py-3 border-b border-line kicker">ON {p.to ?? "—"} · {p.toList.length}</div>
          <div className="flex-1 overflow-y-auto max-h-[60vh]"><List rows={p.toList.filter((r) => moved.has(r.serial))} hi /><List rows={p.toList.filter((r) => !moved.has(r.serial))} /></div></div>
      </div>
    </div>
  );
}
