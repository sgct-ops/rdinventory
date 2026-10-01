import { getCurrentUser } from "@/lib/session";
import { trorView } from "@/lib/floor";
import { trorPdf } from "@/lib/labels";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in", { status: 401 });
  const v = await trorView((await ctx.params).id);
  if (!v) return new Response("No such TROR", { status: 404 });
  const pdf = await trorPdf({ to: v.to, date: v.date, from: v.from, to_: v.to_, reason: v.reason, mo: v.mo, plannedBy: v.plannedBy,
    rows: v.rows.map((r) => ({ row: r.row, fabricNo: r.fabricNo, sku: r.sku, label: r.label, needG: r.needG, suggestions: r.suggestions })) });
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${v.to}.pdf"` } });
}
