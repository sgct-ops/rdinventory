import { runBackup } from "@/lib/health";
import { cronAllowed } from "@/lib/cron";
export const maxDuration = 300;
export async function GET(req: Request) {
  if (!cronAllowed(req)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await runBackup());
}
