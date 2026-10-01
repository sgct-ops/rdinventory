"use client";
import { useState } from "react";

/** Header scan box: scan or type a roll serial, rack label, TO # or order number. */
export function GlobalScan() {
  const [v, setV] = useState("");
  return (
    <div className="flex items-center gap-2.5 flex-1 basis-0 min-w-0 max-w-[420px] h-10 px-3 border-[1.5px] border-ink rounded-lg bg-white">
      <div className="w-3.5 h-3.5 border-2 border-ink rounded-[3px] flex-none" />
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Scan roll, rack, TO # or order…"
        onKeyDown={(e) => { if (e.key === "Enter" && v.trim()) { window.location.assign(`/go?q=${encodeURIComponent(v.trim())}`); setV(""); } }}
        className="flex-1 border-0 bg-transparent outline-none mono text-sm font-medium min-w-0" />
      <div className="mono text-[11px] font-medium text-ok whitespace-nowrap hidden sm:block">● SCANNER</div>
    </div>
  );
}
