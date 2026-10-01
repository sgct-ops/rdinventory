import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/session";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u || u.role !== "ADMIN") return new Response("Forbidden", { status: 403 });
  const [b] = await db.select().from(schema.backups).where(eq(schema.backups.id, (await params).id));
  if (!b) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(b.data), { headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="fabric-backup-${b.createdAt.toISOString().slice(0, 16).replace(":", "")}.json.gz"` } });
}
