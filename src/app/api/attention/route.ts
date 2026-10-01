import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { attentionFor } from "@/lib/attention";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ items: [] }, { status: 401 });
  const a = await attentionFor(u.role, { samples: new URL(req.url).searchParams.has("full") });
  return NextResponse.json({ items: a.items }, { headers: { "cache-control": "no-store" } });
}
