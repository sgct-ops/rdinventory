import { runHealthCheck } from "@/lib/health";
import { cronAllowed } from "@/lib/cron";
export const maxDuration = 300;
export async function GET(req: Request) {
  if (!cronAllowed(req)) return new Response("Unauthorized", { status: 401 });
  const r = await runHealthCheck();
  return Response.json({ id: r.id, issues: (r.issues as unknown[]).length });
}
