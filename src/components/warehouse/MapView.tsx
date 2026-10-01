"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { MapRoll } from "@/lib/warehouse";

type Rack = { id: string; code: string; room: string; building: string; capacity: number; sortOrder: number; locationName: string; lastCountedAt: string | null };
const kgf = (g: number) => (g / 1000).toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const A = "oklch(0.6 0.16 45)";

export function MapView({ racks, rolls, out, fullPct, canWork }: { racks: Rack[]; rolls: MapRoll[]; out: MapRoll[]; fullPct: number; canWork: boolean }) {
  const [mode, setMode] = useState<"dots" | "3d">("dots");
  const [sel, setSel] = useState<string | null>(racks[0]?.code ?? null);
  const router = useRouter();

  const byRack = useMemo(() => {
    const m = new Map<string, MapRoll[]>();
    racks.forEach((r) => m.set(r.id, []));
    rolls.forEach((r) => { if (r.rackId && m.has(r.rackId)) m.get(r.rackId)!.push(r); });
    return m;
  }, [racks, rolls]);
  const onRack = rolls.filter((r) => r.rackId);
  const unplaced = rolls.filter((r) => !r.rackId);
  const legend = [...new Map(onRack.map((r) => [`${r.item}|${r.colour}`, r])).values()];

  const rackInfo = (r: Rack) => {
    const list = [...(byRack.get(r.id) ?? [])];
    const comp = [...list.reduce((m, x) => m.set(x.hex + "|" + (x.colour ?? x.item), (m.get(x.hex + "|" + (x.colour ?? x.item)) ?? 0) + 1), new Map<string, number>())]
      .map(([k, count]) => ({ hex: k.split("|")[0], c: k.split("|")[1], count })).sort((a, b) => b.count - a.count);
    list.sort((a, b) => a.hex.localeCompare(b.hex));
    return { list, n: list.length, kgG: list.reduce((a, x) => a + x.remainingG, 0), pct: Math.round((list.length / r.capacity) * 100), comp };
  };

  // group by building → room, preserving rack sort order
  const buildings = useMemo(() => {
    const b = new Map<string, Map<string, Rack[]>>();
    for (const r of racks) {
      if (!b.has(r.building)) b.set(r.building, new Map());
      const rooms = b.get(r.building)!;
      if (!rooms.has(r.room)) rooms.set(r.room, []);
      rooms.get(r.room)!.push(r);
    }
    return [...b].map(([name, rooms]) => ({ name, rooms: [...rooms].map(([room, rs]) => ({ room, racks: rs })) }));
  }, [racks]);

  const RackCard = ({ r }: { r: Rack }) => {
    const i = rackInfo(r);
    return (
      <Link href={`/warehouse/racks/${r.code}`} className="border-[1.5px] border-ink rounded-lg p-3 flex flex-col gap-2.5 hover:bg-[#faf9f6]">
        <div className="flex items-baseline gap-x-2 gap-y-1 flex-wrap">
          <div className="mono font-semibold text-sm whitespace-nowrap">{r.code}</div>
          <div className="text-xs text-muted">{i.n} rolls · {kgf(i.kgG)} kg</div>
          {i.pct >= fullPct && <div className="pill bg-warnbg text-[11px]">{i.pct}% full</div>}
        </div>
        <div className="grid grid-cols-12 gap-1">
          {i.list.map((x) => (
            <div key={x.id} title={`${x.serial} · ${x.item} ${x.colour ?? ""} · ${kgf(x.remainingG)} kg`} className="aspect-square rounded-full"
              style={{ background: x.hex, boxShadow: x.missing ? `0 0 0 2px oklch(0.58 0.17 28)` : "inset 0 0 0 3px rgba(255,255,255,.18), inset 0 0 0 1px rgba(0,0,0,.2)" }} />
          ))}
          {Array.from({ length: Math.max(0, r.capacity - i.n) }).map((_, k) => <div key={k} className="aspect-square rounded-full border border-dashed border-[#d6d2c9]" />)}
        </div>
      </Link>
    );
  };

  // ---- 3D layout, computed from rooms (no hard-coded coordinates)
  const iso = useMemo(() => {
    const rooms: { name: string; l: number; t: number; w: number; h: number; racks: Rack[] }[] = [];
    let x = 0;
    for (const b of buildings) for (const rm of b.rooms) {
      const w = Math.max(130, rm.racks.length * 52 + 26);
      rooms.push({ name: rm.room, l: x, t: 0, w, h: 300, racks: rm.racks });
      x += w + 8;
    }
    return { rooms, width: x };
  }, [buildings]);

  if (!racks.length) return (
    <div className="p-8"><div className="h1">Rack map</div><div className="sub">No racks yet. {canWork ? <Link className="underline" href="/admin/racks">Add racks</Link> : "Ask the admin to add racks."}</div></div>
  );

  const selRack = racks.find((r) => r.code === sel) ?? racks[0];
  const selInfo = rackInfo(selRack);

  return (
    <div className="p-5 lg:p-7 flex flex-col gap-5">
      <div className="flex items-center gap-5 flex-wrap">
        <div>
          <div className="h1">Rack map</div>
          <div className="sub">{onRack.length} rolls on {racks.length} racks · {kgf(onRack.reduce((a, r) => a + r.remainingG, 0))} kg · click a rack to open it</div>
        </div>
        <div className="ml-auto flex bg-[#e7e4dd] rounded-lg p-[3px] gap-[3px] text-[13px]">
          {(["dots", "3d"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`px-3.5 py-[7px] rounded-md ${mode === m ? "bg-white font-semibold" : ""}`}>{m === "dots" ? "Rolls" : "3D"}</button>
          ))}
        </div>
      </div>

      {unplaced.length > 0 && (
        <div className="bg-warnbg border border-warn rounded-[10px] p-3.5 flex flex-col gap-2.5">
          <div className="text-sm font-semibold">Unplaced · in stock here, not on a rack ({unplaced.length})</div>
          {unplaced.slice(0, 12).map((u) => {
            const ret = u.offRackReason === "RETURNED";
            const tag = u.status === "AWAITING_LABEL" ? "New · label to stick and scan" : ret ? `Back · ${u.offRackRef ?? ""}${u.lastRack ? ` · left ${u.lastRack}` : ""}` : u.offRackReason === "ARRIVED" ? `Arrived · ${u.offRackRef ?? ""}` : "New · registered";
            return (
              <div key={u.id} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2.5 text-[13px] flex-wrap">
                <div className="w-[18px] h-[18px] rounded-full border border-black/20" style={{ background: u.hex }} />
                <Link href={`/rolls/${u.serial}`} className="mono font-semibold text-sm w-[130px]">{u.serial}</Link>
                <div className="flex-1 text-muted min-w-[140px]">{u.item}{u.colour ? ` · ${u.colour}` : ""} · {u.batch}</div>
                <div className={`pill ${ret ? "bg-[oklch(0.93_0.05_300)]" : "bg-okbg"}`}>{tag}</div>
                <div className="font-semibold whitespace-nowrap">{kgf(u.remainingG)} kg</div>
                {canWork && <Link href="/warehouse/put" className="btn btn-sm">{ret ? "Return" : "Put away"}</Link>}
              </div>
            );
          })}
          {unplaced.length > 12 && <div className="text-xs text-muted">+ {unplaced.length - 12} more on Put away</div>}
        </div>
      )}

      {out.length > 0 && (
        <details className="card p-3.5">
          <summary className="text-sm font-semibold cursor-pointer">Out of the warehouse · left in the last 45 days ({out.length})</summary>
          <div className="flex flex-col gap-2 mt-3">
            {out.map((u) => (
              <Link key={u.id} href={`/rolls/${u.serial}`} className="flex items-center gap-3 bg-paper rounded-lg px-3 py-2.5 text-[13px] flex-wrap">
                <div className="w-[18px] h-[18px] rounded-full border border-black/20" style={{ background: u.hex }} />
                <div className="mono font-semibold text-sm w-[130px]">{u.serial}</div>
                <div className="flex-1 text-muted">At {u.location} · left {u.lastRack} on {u.offRackRef}</div>
                <div className="font-medium">{kgf(u.remainingG)} kg</div>
              </Link>
            ))}
          </div>
        </details>
      )}

      {mode === "dots" ? (
        <>
          <div className="flex gap-2 flex-wrap text-xs">
            {legend.map((f) => (
              <div key={f.hex + f.colour} className="flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 border border-line rounded-full bg-white whitespace-nowrap">
                <div className="w-3 h-3 rounded-full border border-black/20" style={{ background: f.hex }} />{f.colour ?? f.item}
              </div>
            ))}
          </div>
          <div className="flex flex-col xl:flex-row gap-3.5">
            {buildings.map((b) => (
              <div key={b.name} className="flex flex-col gap-2.5 min-w-0" style={{ flex: b.rooms.length }}>
                <div className="kicker">{b.name.toUpperCase()}</div>
                <div className="grid gap-3.5" style={{ gridTemplateColumns: `repeat(${Math.min(b.rooms.length, 3)}, minmax(0,1fr))` }}>
                  {b.rooms.map((rm) => (
                    <div key={rm.room} className="card p-4 flex flex-col gap-3">
                      <div className="font-semibold">{rm.room}</div>
                      {rm.racks.map((r) => <RackCard key={r.id} r={r} />)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="bg-[#171715] text-[#f2f0ea] rounded-xl h-[560px] grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_320px] overflow-hidden">
          <div className="relative overflow-hidden" style={{ perspective: 1600 }}>
            <div className="absolute left-1/2 top-1/2" style={{ width: iso.width, height: 300, marginLeft: -iso.width / 2, marginTop: -150,
              transform: `scale(${Math.min(0.8, 760 / Math.max(iso.width, 1))}) rotateX(58deg) rotateZ(-34deg)`, transformStyle: "preserve-3d" }}>
              {iso.rooms.map((p) => (
                <div key={p.name} className="absolute border-2 border-[#4a4944] bg-[#1f1f1c]" style={{ left: p.l, top: p.t, width: p.w, height: p.h }}>
                  <div className="absolute left-2 bottom-1.5 mono text-[13px] font-semibold text-[#8f8b82]">{p.name}</div>
                </div>
              ))}
              {iso.rooms.flatMap((p) => p.racks.map((r, idx) => {
                const i = rackInfo(r);
                const rw = 34, rd = p.h - 60, h = Math.max(2, Math.round((i.n / r.capacity) * 105));
                const step = (p.w - 2 * 14 - rw) / Math.max(1, p.racks.length - 1);
                const l = p.l + 14 + (p.racks.length === 1 ? (p.w - 28 - rw) / 2 : idx * step);
                return (
                  <div key={r.id} onClick={() => setSel(r.code)} className="absolute cursor-pointer" style={{ left: l, top: p.t + 30, width: rw, height: rd, transformStyle: "preserve-3d" }}>
                    <div className="absolute left-0 top-0 bg-[#3a3935]" style={{ width: rw, height: h, transformOrigin: "0 0", transform: "rotateX(90deg)" }} />
                    <div className="absolute left-0 top-0 bg-[#2e2d2a]" style={{ width: h, height: rd, transformOrigin: "0 0", transform: "rotateY(-90deg)" }} />
                    <div className="absolute left-0 top-0 bg-[#454440]" style={{ width: h, height: rd, transformOrigin: "0 0", transform: `translateX(${rw}px) rotateY(-90deg)` }} />
                    <div className="absolute left-0 top-0 flex" style={{ width: rw, height: h, transformOrigin: "0 0", transform: `translateY(${rd}px) rotateX(90deg)` }}>
                      {i.comp.map((c) => <div key={c.hex + c.c} style={{ flex: c.count, background: c.hex }} />)}
                    </div>
                    <div className="absolute left-0 top-0 flex items-center justify-center" style={{ width: rw, height: rd, transform: `translateZ(${h}px)`, background: sel === r.code ? "oklch(0.7 0.15 45)" : "#d8d4ca" }}>
                      <div className="mono text-xs font-semibold text-[#171715] rotate-90 whitespace-nowrap">{r.code}</div>
                    </div>
                  </div>
                );
              }))}
            </div>
            <div className="absolute left-5 bottom-4 mono text-xs text-[#8f8b82]">Height = how full the rack is · click a rack</div>
          </div>
          <div className="p-5 flex flex-col gap-3.5">
            <div className="mono text-[13px] text-[#a9a59c]">{selRack.room} · {selRack.building}</div>
            <div className="mono text-[44px] leading-none font-semibold">{selRack.code}</div>
            <div className="flex gap-6">
              <div><div className="text-[28px] font-semibold">{selInfo.n}</div><div className="text-[13px] text-[#a9a59c]">rolls</div></div>
              <div><div className="text-[28px] font-semibold">{kgf(selInfo.kgG)}</div><div className="text-[13px] text-[#a9a59c]">kg</div></div>
              <div><div className="text-[28px] font-semibold">{selInfo.pct}%</div><div className="text-[13px] text-[#a9a59c]">full</div></div>
            </div>
            <div className="flex flex-col gap-2 overflow-y-auto">
              {selInfo.comp.map((c) => (
                <div key={c.hex + c.c} className="flex items-center gap-2.5 text-sm"><div className="w-3.5 h-3.5 rounded-full" style={{ background: c.hex }} /><div className="flex-1">{c.c}</div><div className="font-semibold">{c.count}</div></div>
              ))}
            </div>
            <button onClick={() => router.push(`/warehouse/racks/${selRack.code}`)} className="mt-auto h-12 rounded-[10px] text-[15px] font-semibold text-[#171715]" style={{ background: "oklch(0.7 0.15 45)" }}>Open rack</button>
          </div>
        </div>
      )}
    </div>
  );
}
export { A as ACCENT };
