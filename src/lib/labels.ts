import "server-only";
import bwipjs from "bwip-js/node";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fmtKg } from "./units";

const MM = 72 / 25.4;

async function code128(text: string) {
  return bwipjs.toBuffer({ bcid: "code128", text, scale: 3, height: 12, includetext: false });
}

export type RollLabel = { serial: string; fabricNo: string; fabric: string; colour: string; batch: string; weighedG: number; cutFrom?: string };

/** One label per page, sized for the office label printer (Settings → label size). */
export async function rollLabelsPdf(labels: RollLabel[], widthMm: number, heightMm: number) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = widthMm * MM, H = heightMm * MM, pad = 3 * MM;
  for (const l of labels) {
    const page = pdf.addPage([W, H]);
    const png = await pdf.embedPng(await code128(l.serial));
    const bh = H * 0.38;
    const bw = Math.min(W - 2 * pad, (png.width / png.height) * bh);
    page.drawImage(png, { x: (W - bw) / 2, y: H - pad - bh, width: bw, height: bh });
    const fs = Math.max(6, Math.min(11, H / 11));
    let y = H - pad - bh - fs * 1.35;
    const line = (t: string, f = font, size = fs) => {
      let s = t;
      while (s.length > 3 && f.widthOfTextAtSize(s, size) > W - 2 * pad) s = s.slice(0, -2);
      page.drawText(s, { x: pad, y, size, font: f, color: rgb(0, 0, 0) });
      y -= size * 1.25;
    };
    line(l.serial, bold, fs * 1.25);
    line(`${l.fabricNo} · ${l.fabric} ${l.colour}`.trim(), bold);
    line(`${fmtKg(l.weighedG, 1)} kg`);
    line(`${l.batch}${l.cutFrom ? ` · cut from ${l.cutFrom}` : ""}`);
  }
  return pdf.save();
}

export async function rackLabelsPdf(codes: string[], widthMm: number, heightMm: number) {
  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = widthMm * MM, H = heightMm * MM, pad = 3 * MM;
  for (const c of codes) {
    const text = `RK-${c}`;
    const page = pdf.addPage([W, H]);
    const png = await pdf.embedPng(await code128(text));
    const bh = H * 0.5;
    const bw = Math.min(W - 2 * pad, (png.width / png.height) * bh);
    page.drawImage(png, { x: (W - bw) / 2, y: H - pad - bh, width: bw, height: bh });
    const size = Math.min(28, H / 4);
    page.drawText(text, { x: (W - bold.widthOfTextAtSize(text, size)) / 2, y: pad, size, font: bold });
  }
  return pdf.save();
}
