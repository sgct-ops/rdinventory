"use client";
import { useState } from "react";
import { saveFormatNoteAction } from "@/app/admin-actions";
export function FormatNote({ field, value, canEdit }: { field: string; value: string; canEdit: boolean }) {
  const [v, setV] = useState(value);
  const [saved, setSaved] = useState(false);
  if (!canEdit) return <span className="text-sm">{value}</span>;
  return <textarea className="input h-auto py-2 text-sm bg-[#fffbe8]" rows={2} value={v} placeholder="Write the format you want…" onChange={(e) => { setV(e.target.value); setSaved(false); }}
    onBlur={async () => { if (v !== value) { const r = await saveFormatNoteAction(field, v); setSaved(r.ok); } }} title={saved ? "Saved" : ""} />;
}
