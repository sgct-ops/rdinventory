import bwipjs from "bwip-js/node";
import { auth } from "@/auth";

/** On-screen Code 128 preview (signed-in users only). */
export async function GET(req: Request) {
  if (!(await auth())?.user) return new Response("Unauthorized", { status: 401 });
  const text = new URL(req.url).searchParams.get("text")?.slice(0, 60) ?? "";
  if (!/^[A-Za-z0-9#\-/ .]+$/.test(text)) return new Response("Bad text", { status: 400 });
  const png = await bwipjs.toBuffer({ bcid: "code128", text, scale: 3, height: 12 });
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" } });
}
