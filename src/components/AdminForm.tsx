"use client";
import { useActionState } from "react";
import type { ActionResult } from "@/lib/errors";

type Act = (prev: unknown, fd: FormData) => Promise<ActionResult>;
/** A form posting to a server action, showing its result inline. */
export function AdminForm({ action, children, className, style, submit = "Save", inline }: { action: Act; children: React.ReactNode; className?: string; style?: React.CSSProperties; submit?: string; inline?: boolean }) {
  const [state, formAction, pending] = useActionState(action, null as ActionResult | null);
  return (
    <form action={formAction} className={className} style={style}>
      {children}
      <div className={`flex items-center gap-3 ${inline ? "" : "mt-3"}`}>
        <button className={inline ? "btn btn-sm" : "btn"} disabled={pending}>{pending ? "…" : submit}</button>
        {state && (state.ok ? <span className="text-xs text-ok">✓ {state.message ?? "Done"}{typeof state.data === "object" && state.data ? " · " + JSON.stringify(state.data) : ""}</span> : <span className="text-xs text-bad">{state.error}</span>)}
      </div>
    </form>
  );
}
