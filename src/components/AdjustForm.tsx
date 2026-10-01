"use client";
import { useState } from "react";
import { requestAdjustmentAction } from "@/app/actions";

export function AdjustForm({ reasons, initialSerial, limitText }: { reasons: [string, string][]; initialSerial: string; limitText: string }) {
  const [serial, setSerial] = useState(initialSerial);
  const [kgChange, setKg] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [photoUrl, setPhoto] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit() {
    setBusy(true);
    const r = await requestAdjustmentAction({ serial, kgChange, reason: reason as never, note, photoUrl });
    setBusy(false);
    if (!r.ok) return setRes({ ok: false, text: r.error });
    setRes({ ok: true, text: r.data!.status === "PENDING" ? `${r.data!.number} sent for approval. It changes the roll once the admin approves.` : `${r.data!.number} posted.` });
    setSerial(""); setKg(""); setReason(""); setNote(""); setPhoto("");
  }
  return (
    <div className="card p-5 grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
      <div><label className="label">Roll serial (scan) *</label><input autoFocus className="input mono uppercase h-12" value={serial} onChange={(e) => setSerial(e.target.value)} /></div>
      <div><label className="label">Kg change * (+ adds, − removes)</label><input className="input h-12 text-lg" inputMode="decimal" placeholder="-1.25" value={kgChange} onChange={(e) => setKg(e.target.value)} /></div>
      <div><label className="label">Reason *</label><select className="input" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Pick…</option>{reasons.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div><label className="label">Photo link (optional)</label><input className="input" value={photoUrl} onChange={(e) => setPhoto(e.target.value)} /></div>
      <div className="md:col-span-2"><label className="label">Note {reason === "OTHER" ? "*" : "(required for Other and above the limit)"}</label><textarea className="input h-20 py-2" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="md:col-span-2 text-xs text-muted">{limitText}</div>
      {res && <div className={`md:col-span-2 text-sm rounded-md px-3 py-2 ${res.ok ? "bg-okbg" : "bg-badbg text-bad"}`}>{res.text}</div>}
      <div><button className="btn h-11 px-6" disabled={busy || !serial || !kgChange || !reason} onClick={submit}>{busy ? "Saving…" : "Post adjustment"}</button></div>
    </div>
  );
}
