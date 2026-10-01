"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ico } from "@/components/icons";

/** The big box on the Find page. Same syntax as Ctrl K. */
export function FindBox({ q, scope }: { q: string; scope: string }) {
  const router = useRouter();
  const [v, setV] = useState(q);
  return (
    <form className="card p-3 sm:p-4 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (v.trim()) router.push(`/find?q=${encodeURIComponent(v.trim())}${scope !== "all" ? `&scope=${scope}` : ""}`); }}>
      <div className="flex gap-2">
        <div className="flex-1 flex items-center gap-2.5 h-12 px-3 rounded-[9px] border-[1.5px] border-ink bg-white min-w-0">
          <Ico name="search" size={18} className="text-muted" />
          <input name="q" value={v} onChange={(e) => setV(e.target.value)} autoFocus spellCheck={false} autoComplete="off"
            className="flex-1 min-w-0 outline-none text-base mono bg-transparent" placeholder="55A, 55A-4821, TROC-012, 12, #CT10252, ct26po48, kg<5 at:Exim…" />
        </div>
        <button className="btn h-12 px-6">Find</button>
      </div>
      <div className="text-[12px] text-muted flex flex-wrap gap-x-4 gap-y-1">
        {["roll:", "fab:", "to:", "rack:", "po:", "style:", "batch:", "loc:", "#order", "kg<5", "at:Exim", "in:awaiting"].map((t) => (
          <button key={t} type="button" className="mono hover:text-ink underline decoration-dotted underline-offset-2" onClick={() => setV((x) => (t.endsWith(":") || t.startsWith("#") ? `${t === "#order" ? "#" : t}${x.replace(/^[a-z]+:\s*/i, "")}` : `${x} ${t}`.trim()))}>{t}</button>))}
      </div>
    </form>
  );
}
