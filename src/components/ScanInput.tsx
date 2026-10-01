"use client";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { pick, WANT_LABEL, type Want, type Parsed } from "@/lib/codes";
import { beep } from "./ScanBox";

export type ScanInputHandle = { focus: () => void; arm: () => void };

/**
 * A text box with a barcode button. Click the button (or press F2 in the box) and the box is ready for the USB scanner:
 * it highlights, and when a full roll label (SERIAL|INVOICE|BATCH) is scanned it keeps only the part this box wants.
 * Scanning the wrong kind of code (a roll label into an SKU box, …) is refused with a clear message.
 */
export const ScanInput = forwardRef<ScanInputHandle, {
  value: string; onChange: (v: string) => void; want: Want;
  onScan?: (value: string, parsed: Parsed) => void | Promise<void>;
  placeholder?: string; list?: string; className?: string; ariaLabel?: string; autoFocus?: boolean; disabled?: boolean; mono?: boolean;
  /** clear the box after onScan (scan-and-go lists) */
  clearOnScan?: boolean;
}>(function ScanInput(p, ref) {
  const input = useRef<HTMLInputElement>(null);
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const arm = () => { setArmed(true); setErr(null); input.current?.focus(); input.current?.select(); };
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus(), arm }));

  const accept = async (raw: string, viaEnter: boolean) => {
    const r = pick(raw, p.want);
    if (r.error) { setErr(r.error); beep(false); p.onChange(""); return; }
    setErr(null);
    p.onChange(r.value);
    if (viaEnter && p.onScan && r.value) {
      await p.onScan(r.value, r.parsed);
      if (p.clearOnScan) p.onChange("");
    }
    if (viaEnter) setArmed(false);
  };

  return (
    <div className="min-w-0">
      <div className={`relative flex items-center rounded-[9px] transition-shadow ${armed ? "ring-4 ring-[oklch(0.85_0.1_250)]" : ""}`}>
        <input ref={input} value={p.value} disabled={p.disabled} list={p.list} placeholder={armed ? `Scan the ${WANT_LABEL[p.want]} now…` : p.placeholder}
          aria-label={p.ariaLabel ?? p.placeholder} autoFocus={p.autoFocus} autoComplete="off" spellCheck={false} data-want={p.want}
          className={`input pr-12 ${p.mono ? "mono" : ""} ${armed ? "border-[oklch(0.55_0.13_250)]" : ""} ${err ? "border-bad" : ""} ${p.className ?? ""}`}
          onBlur={() => setArmed(false)}
          onChange={(e) => {
            const v = e.target.value;
            // a full roll label arrives in one go from the scanner: keep only the part this box wants
            if (v.includes("|") || v.includes("¦")) { void accept(v, false); return; }
            setErr(null); p.onChange(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "F2") { e.preventDefault(); arm(); }
            if (e.key === "Enter") { e.preventDefault(); void accept((e.target as HTMLInputElement).value, true); }
          }} />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={arm} disabled={p.disabled}
          title={`Scan: ${WANT_LABEL[p.want]} (F2)`} aria-label={`Scan ${WANT_LABEL[p.want]}`}
          className={`absolute right-1.5 h-8 w-9 grid place-items-center rounded-md border cursor-pointer ${armed ? "bg-[oklch(0.48_0.13_250)] text-white border-transparent" : "bg-white border-line text-ink hover:border-ink"}`}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M3 5v14M6 5v14M9 5v14M13 5v14M15 5v14M18 5v14M21 5v14" /></svg>
        </button>
      </div>
      {err && <div className="text-xs text-bad mt-1" role="alert">{err}</div>}
      {armed && !err && <div className="text-[11px] text-[oklch(0.45_0.13_250)] mt-1">● Ready — scan the {WANT_LABEL[p.want]}</div>}
    </div>
  );
});
