import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { rollLabelsPdf } from "@/lib/labels";
import { serialOf } from "@/lib/codes";

export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u || u.role !== "ADMIN") return new Response("Only the admin prints labels", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const ids = (sp.get("ids") ?? "").split(",").filter(Boolean).slice(0, 500);
  const serials = (sp.get("serials") ?? "").split(",").map((s) => serialOf(s)).filter(Boolean).slice(0, 500);
  if (!ids.length && !serials.length) return new Response("No rolls", { status: 400 });
  const rows = await db.select({ r: schema.rolls, f: schema.fabricItems, b: schema.batches }).from(schema.rolls)
    .innerJoin(schema.fabricItems, eq(schema.fabricItems.id, schema.rolls.fabricItemId))
    .innerJoin(schema.batches, eq(schema.batches.id, schema.rolls.batchId)).where(ids.length ? inArray(schema.rolls.id, ids) : inArray(schema.rolls.serial, serials));
  const s = await getSettings();
  const cutFrom = new Map((await db.select({ id: schema.rolls.id, s: schema.rolls.serial }).from(schema.rolls).where(inArray(schema.rolls.id, rows.map((x) => x.r.splitFromId).filter(Boolean) as string[]))).map((x) => [x.id, x.s]));
  const pdf = await rollLabelsPdf(rows.map(({ r, f, b }) => ({ serial: r.serial, fabricNo: f.fabricNo ?? "", fabric: f.cwFabricCode ?? f.itemName, colour: f.colour ?? "", batch: b.code, weighedG: r.weighedG,
    cutFrom: r.splitFromId ? cutFrom.get(r.splitFromId) : undefined, invoice: r.invoiceNo, sku: f.sku })),
    Number(s.labelWidthMm), Number(s.labelHeightMm));
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="roll-labels.pdf"` } });
}
