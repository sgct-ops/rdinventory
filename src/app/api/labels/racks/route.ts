import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { rackLabelsPdf } from "@/lib/labels";

export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u || u.role !== "ADMIN") return new Response("Only the admin prints labels", { status: 403 });
  const q = new URL(req.url).searchParams.get("codes");
  const all = await db.select().from(schema.racks).where(eq(schema.racks.active, true)).orderBy(asc(schema.racks.sortOrder), asc(schema.racks.code));
  const want = q ? q.split(",").map((c) => c.trim().toUpperCase()) : all.map((r) => r.code);
  const codes = all.map((r) => r.code).filter((c) => want.includes(c));
  const s = await getSettings();
  const pdf = await rackLabelsPdf(codes, Number(s.labelWidthMm), Number(s.labelHeightMm));
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="rack-labels.pdf"` } });
}
