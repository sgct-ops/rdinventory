import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { searchAll, type Kind } from "@/lib/search";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const r = await searchAll((p.get("q") ?? "").slice(0, 200), u.role, { scope: (p.get("scope") as Kind) || "all", per: Math.min(25, Number(p.get("per")) || 6) });
  return NextResponse.json(r, { headers: { "cache-control": "private, max-age=5" } });
}
