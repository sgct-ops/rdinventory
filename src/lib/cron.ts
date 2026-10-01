import { timingSafeEqual } from "crypto";
/** Vercel Cron sends "Authorization: Bearer $CRON_SECRET". */
export function cronAllowed(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
