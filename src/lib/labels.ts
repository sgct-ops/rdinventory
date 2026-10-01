import "server-only";
import bwipjs from "bwip-js/node";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fmtKg } from "./units";
import { rollBarcode } from "./codes";

const MM = 72 / 25.4;

async function code128(text: string) {
  return bwipjs.toBuffer({ bcid: "code128", text, scale: 3, height: 12, includetext: false });
}

export type RollLabel = { serial: string; fabricNo: string; fabric: string; colour: string; batch: string; weighedG: number; cutFrom?: string; invoice?: string | null; sku?: string | null };

/** One label per page, sized for the office label printer (Settings → label size).
 * The barcode holds SERIAL|INVOICE|BATCH (see lib/codes.ts) so one scan gives the roll, its invoice and batch. */
export async function rollLabelsPdf(labels: RollLabel[], widthMm: number, heightMm: number) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = widthMm * MM, H = heightMm * MM, pad = 3 * MM;
  for (const l of labels) {
    const page = pdf.addPage([W, H]);
    const png = await pdf.embedPng(await code128(rollBarcode(l.serial, l.invoice, l.batch)));
    const bh = H * 0.34;
    // the long three-part code uses the full label width so the bars stay wide enough to scan
    const bw = W - 2 * pad;
    page.drawImage(png, { x: pad, y: H - pad - bh, width: bw, height: bh });
    const fs = Math.max(6, Math.min(10.5, H / 12));
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
    line(`Batch ${l.batch}${l.cutFrom ? ` · cut from ${l.cutFrom}` : ""}`);
    if (l.invoice) line(`Invoice ${l.invoice}${l.sku ? ` · ${l.sku}` : ""}`);
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

export type TrorPdf = {
  to: string; date: string; from: string; to_: string; reason: string | null; mo: string | null; plannedBy: string | null;
  rows: { row: number; fabricNo: string | null; sku: string | null; label: string; needG: number; suggestions: { serial: string; kgG: number; rack: string | null; room: string | null }[] }[];
};

/** A4 TROR for the warehouse: big barcode of the TROR number to scan on "Pick a TROR", the rows, and the oldest rolls to look at first. */
export async function trorPdf(t: TrorPdf) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, m = 40;
  let page = pdf.addPage([W, H]);
  let y = H - m;
  const text = (s: string, x: number, size = 10, f = font, color = rgb(0, 0, 0)) => page.drawText(s.replace(/[^\x20-\x7e]/g, "-"), { x, y, size, font: f, color });
  text("TRANSFER ORDER", m, 10, bold, rgb(0.4, 0.4, 0.4)); y -= 26;
  text(t.to, m, 26, bold); y -= 8;
  const png = await pdf.embedPng(await bwipjs.toBuffer({ bcid: "code128", text: t.to, scale: 3, height: 14, includetext: false }));
  page.drawImage(png, { x: W - m - 220, y: y - 6, width: 220, height: 50 });
  y -= 22;
  text(`${t.from}  ->  ${t.to_}`, m, 13, bold); y -= 16;
  text(`Date ${t.date}${t.mo ? `   MO ${t.mo}` : ""}${t.plannedBy ? `   Made by ${t.plannedBy}` : ""}`, m, 9, font, rgb(0.35, 0.35, 0.35)); y -= 14;
  if (t.reason) { text(`Reason: ${t.reason.slice(0, 110)}`, m, 9); y -= 14; }
  y -= 6;
  text("Warehouse: scan this barcode on Pick a TROR, then scan each roll as it leaves the rack. Any batch of the fabric is fine. Press Dispatch when done.", m, 8.5, font, rgb(0.35, 0.35, 0.35));
  y -= 22;
  for (const r of t.rows) {
    if (y < m + 90) { page = pdf.addPage([W, H]); y = H - m; }
    page.drawRectangle({ x: m, y: y - 6, width: W - 2 * m, height: 22, color: rgb(0.95, 0.94, 0.92) });
    text(`${r.row}.  ${r.fabricNo ?? ""}  ${r.label}`.slice(0, 80), m + 6, 11, bold);
    text(`${fmtKg(r.needG)} kg`, W - m - 80, 11, bold);
    y -= 20;
    if (r.sku) { text(`SKU ${r.sku}`, m + 20, 9, font, rgb(0.35, 0.35, 0.35)); y -= 13; }
    text("Oldest rolls first (suggested):", m + 20, 8.5, font, rgb(0.35, 0.35, 0.35)); y -= 12;
    for (const s of r.suggestions.slice(0, 6)) {
      text(`[  ]  ${s.serial}    ${fmtKg(s.kgG)} kg    ${s.rack ? `rack ${s.rack} - ${s.room}` : "not on a rack"}`, m + 26, 9.5); y -= 13;
    }
    y -= 10;
  }
  return pdf.save();
}
