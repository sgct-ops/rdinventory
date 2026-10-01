"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveGroupAction, addColourAction, suggestFabricAction, buildGroupsAction } from "@/app/actions";
import { beep } from "./ScanBox";

type Item = { id: string; colour: string | null; fabricNo: string | null; sku: string | null; itemName: string; hex: string | null; active: boolean };
type Group = { id: string; name: string; code: string; kind: string; pairGroupId: string | null; pairName: string | null; cwFabricCode: string | null; vendor: string | null; items: Item[] };
const KIND: Record<string, [string, string]> = { SJ: ["Single Jersey", "bg-[#eaf1fb] text-[#2459a8]"], RIB: ["Rib", "bg-[oklch(0.95_0.03_300)] text-[oklch(0.45_0.14_300)]"], OTHER: ["Other", "bg-chip text-muted"] };

/** Fabric group × colour. Adding a colour gives it its Fabric # and SKU (Rib = Single Jersey number + B), which you can change. */
export function FabricRepo({ groups, loose }: { groups: Group[]; loose: number }) {
  const router = useRouter();
  const [sel, setSel] = useState<string | null>(groups[0]?.id ?? null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const g = groups.find((x) => x.id === sel) ?? null;
  const shown = useMemo(() => groups.filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()) || x.items.some((i) => `${i.colour} ${i.fabricNo} ${i.sku}`.toLowerCase().includes(q.toLowerCase()))), [groups, q]);

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {loose > 0 && (
        <div className="card p-4 flex items-center gap-3 flex-wrap bg-warnbg">
          <div className="text-sm flex-1 min-w-[240px]"><b>{loose} fabric item{loose === 1 ? "" : "s"}</b> (e.g. from the Zoho import) aren&apos;t in a group yet. Put them into groups by their group name / Carbonwork code.</div>
          <button className="btn btn-sm" onClick={async () => { const r = await buildGroupsAction(); if (r.ok) { setMsg({ ok: true, t: `${r.data!.made} groups made, ${r.data!.linked} items linked${r.data!.skipped.length ? `. Skipped: ${r.data!.skipped.join("; ")}` : ""}.` }); router.refresh(); } else setMsg({ ok: false, t: r.error }); }}>Build groups</button>
        </div>)}
      {msg && <div className={`text-sm rounded-md px-3 py-2 ${msg.ok ? "bg-okbg" : "bg-badbg text-bad"}`}>{msg.t}</div>}
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] min-w-0">
        <div className="card flex flex-col min-w-0 max-h-[calc(100dvh-220px)]">
          <div className="p-3 border-b border-line flex flex-col gap-2">
            <input className="input h-10" placeholder="Search groups, colours, Fabric #…" value={q} onChange={(e) => setQ(e.target.value)} />
            <NewGroup groups={groups} onDone={(id) => { setSel(id); router.refresh(); }} />
          </div>
          <div className="overflow-y-auto flex-1">
            {shown.map((x) => (
              <button key={x.id} onClick={() => setSel(x.id)} className={`w-full text-left px-3 py-2.5 border-b border-line2 flex items-center gap-2 cursor-pointer ${sel === x.id ? "bg-ink text-white" : "hover:bg-[#faf9f6]"}`}>
                <div className="flex-1 min-w-0"><div className="font-medium truncate">{x.name}</div>
                  <div className={`text-[11.5px] truncate ${sel === x.id ? "text-white/70" : "text-muted"}`}>{x.items.length} colour{x.items.length === 1 ? "" : "s"}{x.pairName ? ` · pairs with ${x.pairName}` : ""}</div></div>
                <span className={`pill text-[10.5px] ${sel === x.id ? "bg-white/15 text-white" : KIND[x.kind]?.[1]}`}>{KIND[x.kind]?.[0] ?? x.kind}</span>
              </button>))}
            {!shown.length && <div className="p-6 text-sm text-muted text-center">No groups yet. Add the first one above.</div>}
          </div>
        </div>
        {g ? <GroupPane key={g.id} g={g} groups={groups} onChange={() => router.refresh()} /> : <div className="card p-8 text-muted">Pick a group.</div>}
      </div>
    </div>
  );
}

function NewGroup({ groups, onDone }: { groups: Group[]; onDone: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(""); const [cw, setCw] = useState(""); const [vendor, setVendor] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <button className="btn-ghost btn-sm h-9" onClick={() => setOpen(true)}>+ New fabric group</button>;
  const rib = /\brib\b/i.test(name);
  const twin = groups.find((x) => x.name.replace(/\brib\b/gi, "").trim().toUpperCase() === name.replace(/\brib\b/gi, "").trim().toUpperCase() && x.name.toUpperCase() !== name.trim().toUpperCase());
  return (
    <div className="flex flex-col gap-2 p-2 rounded-lg bg-[#faf9f6] border border-line2">
      <input className="input h-10" autoFocus placeholder="Fabric 8D2  ·  Fabric 8D2 Rib" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="grid grid-cols-2 gap-2"><input className="input h-10" placeholder="Carbonwork code" value={cw} onChange={(e) => setCw(e.target.value)} /><input className="input h-10" placeholder="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} /></div>
      {name && <div className="text-[11.5px] text-muted">{rib ? "Rib group" : "Single Jersey group"}{twin ? ` · will pair with ${twin.name}` : ""}</div>}
      {err && <div className="text-xs text-bad">{err}</div>}
      <div className="flex gap-2"><button className="btn btn-sm" onClick={async () => { const r = await saveGroupAction({ name, cwFabricCode: cw, vendor }); if (!r.ok) { setErr(r.error); return; } setOpen(false); setName(""); onDone(r.data!.id); }}>Create</button>
        <button className="btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button></div>
    </div>
  );
}

function GroupPane({ g, groups, onChange }: { g: Group; groups: Group[]; onChange: () => void }) {
  const [colour, setColour] = useState(""); const [fno, setFno] = useState(""); const [sku, setSku] = useState(""); const [hex, setHex] = useState("#888888"); const [zoho, setZoho] = useState("");
  const [sug, setSug] = useState<{ fabricNo: string; sku: string; why: string; exists: { fabricNo: string | null; sku: string | null } | null; itemName: string } | null>(null);
  const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  useEffect(() => {
    if (!colour.trim()) { setSug(null); return; }
    const t = setTimeout(async () => { const r = await suggestFabricAction(g.id, colour); if (r.ok) setSug(r.data as never); }, 250);
    return () => clearTimeout(t);
  }, [colour, g.id]);
  const pair = g.pairGroupId ? groups.find((x) => x.id === g.pairGroupId) : null;
  async function add() {
    setBusy(true); setErr(null); setOk(null);
    const r = await addColourAction({ groupId: g.id, colour, fabricNo: fno || undefined, sku: sku || undefined, hex, zohoItemId: zoho || undefined });
    setBusy(false);
    if (!r.ok) { setErr(r.error); beep(false); return; }
    beep(true); setOk(`${colour} added as ${r.data!.fabricNo} · ${r.data!.sku}`); setColour(""); setFno(""); setSku(""); setZoho(""); onChange();
  }
  return (
    <div className="card flex flex-col min-w-0">
      <div className="px-5 py-4 border-b border-line flex items-center gap-3 flex-wrap">
        <div className="text-lg font-semibold">{g.name}</div>
        <span className={`pill ${KIND[g.kind]?.[1]}`}>{KIND[g.kind]?.[0]}</span>
        <span className="text-sm text-muted">code <b className="mono text-ink">{g.code}</b>{g.cwFabricCode ? ` · Carbonwork ${g.cwFabricCode}` : ""}{pair ? ` · pairs with ${pair.name}` : ""}</span>
        <button className="btn-ghost btn-sm ml-auto" onClick={() => setEdit(!edit)}>{edit ? "Close" : "Edit group"}</button>
      </div>
      {edit && <EditGroup g={g} groups={groups} onDone={() => { setEdit(false); onChange(); }} />}
      <div className="p-5 border-b border-line bg-[#fcfbf9] flex flex-col gap-3">
        <div className="font-semibold text-sm">Add a colour</div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1fr)_70px]">
          <div><label className="label">Colour *</label><input className="input" placeholder="Pine Green" value={colour} onChange={(e) => setColour(e.target.value)} /></div>
          <div><label className="label">Fabric #</label><input className="input mono uppercase" placeholder={sug?.fabricNo ?? "auto"} value={fno} onChange={(e) => setFno(e.target.value)} /></div>
          <div><label className="label">SKU</label><input className="input mono uppercase" placeholder={sug?.sku ?? "auto"} value={sku} onChange={(e) => setSku(e.target.value)} /></div>
          <div><label className="label">Swatch</label><input type="color" className="input p-1" value={hex} onChange={(e) => setHex(e.target.value)} /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] items-end">
          <div><label className="label">Zoho item ID</label><input className="input" placeholder="Optional" value={zoho} onChange={(e) => setZoho(e.target.value)} /></div>
          <button className="btn" disabled={busy || !colour.trim() || !!sug?.exists} onClick={add}>{busy ? "Adding…" : "Add colour"}</button>
        </div>
        {sug && (sug.exists
          ? <div className="text-sm text-bad">{g.name} already has {colour} ({sug.exists.fabricNo}{sug.exists.sku ? ` · ${sug.exists.sku}` : ""}). Colour is unique inside a group.</div>
          : <div className="text-[12.5px] text-muted">Will be <b className="mono text-ink">{fno || sug.fabricNo}</b> · <b className="mono text-ink">{sku || sug.sku}</b> · Zoho name “{sug.itemName}” — {sug.why}. Type in the boxes to use your own.</div>)}
        {err && <div className="text-sm text-bad">{err}</div>}{ok && <div className="text-sm bg-okbg rounded-md px-3 py-2">{ok}</div>}
      </div>
      <div className="overflow-x-auto"><table className="tbl"><thead><tr><th></th><th>COLOUR</th><th>FABRIC #</th><th>SKU</th><th>ZOHO ITEM</th>{pair && <th>{pair.kind === "RIB" ? "RIB" : "SINGLE JERSEY"} TWIN</th>}</tr></thead>
        <tbody>{g.items.map((i) => {
          const twin = pair?.items.find((x) => (x.colour ?? "").toUpperCase() === (i.colour ?? "").toUpperCase());
          return (<tr key={i.id} className={i.active ? "" : "text-faint"}><td><span className="inline-block w-4 h-4 rounded border border-line" style={{ background: i.hex ?? "#ddd" }} /></td><td className="font-medium">{i.colour}</td>
            <td className="mono font-semibold">{i.fabricNo}</td><td className="mono text-xs">{i.sku}</td><td className="text-xs text-muted">{i.itemName}</td>
            {pair && <td className="mono text-xs">{twin ? `${twin.fabricNo} · ${twin.sku ?? ""}` : <span className="text-faint">—</span>}</td>}</tr>);
        })}
          {!g.items.length && <tr><td colSpan={6} className="text-center text-muted py-8">No colours yet.</td></tr>}</tbody></table></div>
    </div>
  );
}

function EditGroup({ g, groups, onDone }: { g: Group; groups: Group[]; onDone: () => void }) {
  const [name, setName] = useState(g.name); const [code, setCode] = useState(g.code); const [kind, setKind] = useState(g.kind); const [pair, setPair] = useState(g.pairGroupId ?? "");
  const [cw, setCw] = useState(g.cwFabricCode ?? ""); const [vendor, setVendor] = useState(g.vendor ?? ""); const [err, setErr] = useState<string | null>(null);
  return (
    <div className="p-5 border-b border-line grid gap-3 sm:grid-cols-3">
      <div><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label className="label">SKU code</label><input className="input mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} /></div>
      <div><label className="label">Kind</label><select className="input" value={kind} onChange={(e) => setKind(e.target.value)}><option value="SJ">Single Jersey</option><option value="RIB">Rib</option><option value="OTHER">Other</option></select></div>
      <div><label className="label">Pairs with</label><select className="input" value={pair} onChange={(e) => setPair(e.target.value)}><option value="">—</option>{groups.filter((x) => x.id !== g.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
      <div><label className="label">Carbonwork code</label><input className="input" value={cw} onChange={(e) => setCw(e.target.value)} /></div>
      <div><label className="label">Vendor</label><input className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} /></div>
      {err && <div className="text-sm text-bad sm:col-span-3">{err}</div>}
      <div className="sm:col-span-3"><button className="btn btn-sm" onClick={async () => { const r = await saveGroupAction({ id: g.id, name, code, kind, pairGroupId: pair || null, cwFabricCode: cw, vendor }); if (!r.ok) setErr(r.error); else onDone(); }}>Save group</button></div>
    </div>
  );
}
