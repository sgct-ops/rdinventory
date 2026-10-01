"use client";
import { useEffect, useState } from "react";
import { zohoPromptAction } from "@/app/actions";

export function ZohoPrompt({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  const [r, setR] = useState<{ text: string; found: number; missing: string[]; already: string[] } | null>(null);
  const [msg, setMsg] = useState("");
  const build = async (v: string) => { const x = await zohoPromptAction(v); if (x.ok) setR(x.data!); else setMsg(x.error); };
  useEffect(() => { if (initial) build(initial); }, [initial]);
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-4 max-w-5xl">
      <div><span className="pill bg-[#efeafb] text-[#5b3fa8] font-semibold">ZOHO</span><div className="h1 mt-2">Zoho prompt for TROs</div>
        <div className="sub">Type TRO numbers, a bare number like 12, or ALL for every TO not yet ticked “Entered in Zoho”. Paste the prompt into Claude with the Zoho connector on — Claude creates them in Zoho with the same numbers.</div></div>
      <div className="card p-4 flex gap-2 flex-wrap">
        <input className="input flex-1 min-w-[220px] mono" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") build(q); }} placeholder="TROR-004, TROC-005" />
        <button className="btn" onClick={() => build(q)}>Build prompt</button>
        <button className="btn-ghost" onClick={() => { setQ("ALL"); build("ALL"); }}>All not in Zoho</button>
      </div>
      {r && <div className="flex gap-2 flex-wrap text-sm">
        <span className={`pill ${r.found ? "bg-okbg text-ok" : "bg-chip"}`}>{r.found ? `${r.found} TO${r.found === 1 ? "" : "s"} in the prompt` : "Nothing found"}</span>
        {r.missing.length > 0 && <span className="pill bg-warnbg">not in TO Log: {r.missing.join(", ")}</span>}
        {r.already.length > 0 && <span className="pill bg-[#eaf1fb]">already ticked in Zoho: {r.already.join(", ")}</span>}</div>}
      <textarea readOnly value={r?.text ?? ""} rows={22} className="input h-auto py-3 mono text-xs leading-relaxed bg-[#fbfcfb]" />
      <div className="flex gap-2 items-center">
        <button className="btn" disabled={!r?.text} onClick={async () => { try { await navigator.clipboard.writeText(r!.text); setMsg("Copied. Paste it into Claude."); } catch { setMsg("Select the text and press Ctrl+C."); } }}>Copy prompt</button>
        <span className="text-sm text-muted">{msg}</span>
      </div>
    </div>
  );
}
