import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { savePO } from "@/lib/purchasing";

/**
 * Automatic PO sync from Zoho / Carbonwork:
 *   POST /api/sync/pos   Authorization: Bearer <PO_API_KEY>
 *   [{ "po": "CT26/PO/48", "vendor": "RSWM", "expected_date": "2026-10-04", "lines": [{ "fabric": "55A", "kg": 120, "rolls": 5 }] }]
 * Each PO's lines are replaced with the ones sent. The key lives only in the server's environment (never in git).
 */
function authorised(req: Request) {
  const key = process.env.PO_API_KEY;
  if (!key || key.length < 24) return false;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "send JSON" }, { status: 400 }); }
  const list = Array.isArray(body) ? body : [body];
  const api = { id: "api", email: "api", name: "PO sync", role: "ADMIN" as const, allLocations: true, allStylePOs: true, locationIds: [], stylePOCodes: [] };
  const done: string[] = [], failed: { po: string; error: string }[] = [];
  for (const x of list.slice(0, 500) as Record<string, unknown>[]) {
    const po = String(x.po ?? x.po_number ?? "");
    try {
      const lines = (Array.isArray(x.lines) ? x.lines : []) as Record<string, unknown>[];
      const r = await savePO(api, { poNumber: po, vendor: String(x.vendor ?? ""), expectedDate: x.expected_date ? String(x.expected_date) : undefined, source: String(x.source ?? "API").toUpperCase(),
        lines: lines.map((l) => ({ item: String(l.fabric ?? l.sku ?? l.item ?? ""), kg: String(l.kg ?? ""), rolls: l.rolls === undefined ? undefined : String(l.rolls) })) });
      done.push(r.po);
    } catch (e) { failed.push({ po, error: e instanceof Error ? e.message : String(e) }); }
  }
  return NextResponse.json({ done, failed });
}
