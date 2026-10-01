"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type ScanBoxHandle = { focus: () => void };

/** One large scan box that keeps focus. A USB scanner types the code and presses Enter. */
export const ScanBox = forwardRef<ScanBoxHandle, {
  onScan: (code: string) => void | Promise<void>;
  placeholder?: string;
  disabled?: boolean;
  keepFocus?: boolean;
}>(function ScanBox({ onScan, placeholder, disabled, keepFocus = true }, ref) {
  const input = useRef<HTMLInputElement>(null);
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }));
  useEffect(() => {
    input.current?.focus();
    if (!keepFocus) return;
    // Clicking anywhere that isn't another field puts the cursor back in the scan box.
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input,select,textarea,[contenteditable],summary,dialog")) return;
      setTimeout(() => input.current?.focus(), 0);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [keepFocus]);
  return (
    <div className="scanbox">
      <div className="w-4 h-4 border-2 border-ink rounded-[3px] flex-none" />
      <input ref={input} value={v} disabled={disabled} placeholder={placeholder ?? "Scan…"} autoComplete="off" spellCheck={false}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const code = v.trim();
          if (!code || busy) return;
          setV("");
          setBusy(true);
          try { await onScan(code.toUpperCase()); } finally { setBusy(false); input.current?.focus(); }
        }} />
      <div className={`mono text-[11px] font-medium whitespace-nowrap ${busy ? "text-accent" : "text-ok"}`}>{busy ? "● CHECKING" : "● SCANNER"}</div>
    </div>
  );
});

export function Msg({ r }: { r: { ok: boolean; error?: string; message?: string } | null | undefined }) {
  if (!r) return null;
  if (r.ok) return r.message ? <div className="text-sm bg-okbg rounded-md px-3 py-2">{r.message}</div> : null;
  return <div className="text-sm bg-badbg text-bad rounded-md px-3 py-2">{r.error}</div>;
}

export const kg = (g: number | null | undefined, d = 2) =>
  ((g ?? 0) / 1000).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: 3 });

/** Short scanner beep: high = OK, low = problem. */
export function beep(ok: boolean) {
  try {
    const A = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const a = new A(); const o = a.createOscillator(); const g = a.createGain();
    o.frequency.value = ok ? 880 : 220; g.gain.value = 0.08; o.connect(g); g.connect(a.destination); o.start();
    setTimeout(() => { o.stop(); a.close(); }, ok ? 90 : 300);
  } catch {}
}
