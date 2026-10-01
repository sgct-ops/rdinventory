import { pageUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { FORMATS } from "@/lib/formats";
import { FormatNote } from "@/components/FormatNote";

export default async function Page() {
  const u = await pageUser();
  const notes = JSON.parse((await getSettings()).formatNotes || "{}") as Record<string, string>;
  return (
    <div className="p-4 lg:p-7 flex flex-col gap-4">
      <div><div className="h1">Formats</div><div className="sub">What every input must look like. {u.role === "ADMIN" ? "Write the format you want in the yellow column, then send it to Claude to change the rule." : ""}</div></div>
      <div className="card overflow-x-auto"><table className="tbl">
        <thead><tr><th>FIELD</th><th>WHERE YOU ENTER IT</th><th>FORMAT NOW</th><th>EXAMPLE</th><th>SET BY</th><th>YOUR FORMAT</th></tr></thead>
        <tbody>{FORMATS.map(([f, where, rule, ex, by]) => (
          <tr key={f} className="align-top"><td className="font-semibold">{f}</td><td className="text-muted">{where}</td><td className="max-w-md">{rule}</td><td className="mono text-ok text-xs">{ex}</td><td className="text-muted">{by}</td>
            <td className="min-w-[220px]"><FormatNote field={f} value={notes[f] ?? ""} canEdit={u.role === "ADMIN"} /></td></tr>))}</tbody></table></div>
    </div>
  );
}
