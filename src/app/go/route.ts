import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { findAnything } from "@/lib/posting";

/**
 * /go?q=…  — what the scanner box and Ctrl K use. An exact roll, rack or TO opens straight away
 * with a real redirect (no loading screen in between); anything else goes to the Find page.
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 200);
  const to = (path: string) => NextResponse.redirect(new URL(path, req.nextUrl.origin), 303);
  if (!(await getCurrentUser())) return to("/login");
  if (!q) return to("/find");
  const plain = !/^[a-z]+:|kg\s*[<>]|\b(at|in):/i.test(q);
  if (plain) {
    const r = await findAnything(q);
    if (r.kind === "roll") return to(`/rolls/${encodeURIComponent(r.serial)}`);
    if (r.kind === "rack") return to(`/warehouse/racks/${encodeURIComponent(r.code)}`);
    if (r.kind === "to") return to(`/log/${r.id}`);
  }
  return to(`/find?q=${encodeURIComponent(q)}`);
}
