import "server-only";
import bwipjs from "bwip-js/node";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fmtKg } from "./units";
import { rollBarcode } from "./codes";

const MM = 72 / 25.4;

type Page = ReturnType<PDFDocument["addPage"]>;

/**
 * Code 128 drawn as solid black vector bars (no image): thermal printers print it crisply, and nothing depends on
 * how the driver scales or treats a transparent PNG. Every bar is a whole number of printer dots wide, so a
 * narrow bar never falls below one dot. Returns the width used.
 */
function drawCode128(page: Page, text: string, o: { x: number; y: number; maxW: number; h: number; dpi: number; maxModuleMm?: number; center?: boolean }) {
  const sbs = (bwipjs.raw({ bcid: "code128", text })[0] as { sbs: number[] }).sbs; // bar, space, bar … widths in modules
  const modules = sbs.reduce((a, b) => a + b, 0) + 20; // + 10-module quiet zone each side
  const dot = 72 / o.dpi; // one printer dot in PDF points
  const maxDots = Math.max(1, Math.floor(((o.maxModuleMm ?? 0.5) * MM) / dot));
  const dots = Math.max(1, Math.min(maxDots, Math.floor(o.maxW / modules / dot)));
  const mw = dots * dot, w = modules * mw;
  let x = (o.center ? o.x + (o.maxW - w) / 2 : o.x) + 10 * mw;
  sbs.forEach((n, i) => { if (i % 2 === 0) page.drawRectangle({ x, y: o.y, width: n * mw, height: o.h, color: rgb(0, 0, 0) }); x += n * mw; });
  return { w, moduleMm: mw / MM };
}

/** QR code as vector squares, each module a whole number of printer dots. */
function drawQR(page: Page, text: string, o: { x: number; y: number; size: number; dpi: number }) {
  const q = bwipjs.raw({ bcid: "qrcode", text, eclevel: "M" } as Parameters<typeof bwipjs.raw>[0])[0] as unknown as { pixs: number[]; pixx: number; pixy: number };
  const dot = 72 / o.dpi, n = q.pixx + 2; // + 1-module margin each side (the label edge adds more)
  const m = Math.max(1, Math.floor(o.size / n / dot)) * dot;
  for (let r = 0; r < q.pixy; r++) for (let c = 0; c < q.pixx; c++)
    if (q.pixs[r * q.pixx + c]) page.drawRectangle({ x: o.x + (c + 1) * m, y: o.y + o.size - (r + 2) * m, width: m, height: m, color: rgb(0, 0, 0) });
  return n * m;
}

export type RollLabel = { serial: string; fabricNo: string; fabric: string; colour: string; batch: string; weighedG: number; cutFrom?: string; invoice?: string | null; sku?: string | null };

/**
 * One label per page, exactly the sticker size (Settings → label size, default 90 × 60 mm).
 * The big barcode holds just the serial, so the bars can be 0.5 mm wide (4 dots on a 203 dpi TSC) and scan from a distance;
 * the app looks up the invoice and batch from the serial. The small QR holds SERIAL|INVOICE|BATCH for 2D scanners.
 */
export async function rollLabelsPdf(labels: RollLabel[], widthMm: number, heightMm: number, dpi = 203) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = widthMm * MM, H = heightMm * MM, pad = 3 * MM;
  for (const l of labels) {
    const page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
    const bh = Math.min(22 * MM, H * 0.36);
    drawCode128(page, l.serial, { x: pad, y: H - pad - bh, maxW: W - 2 * pad, h: bh, dpi, center: true });
    // serial in big type right under the bars
    const ss = Math.min(22, H / 9);
    const sw = bold.widthOfTextAtSize(l.serial, ss);
    let y = H - pad - bh - ss - 1.5 * MM;
    page.drawText(l.serial, { x: (W - sw) / 2, y, size: ss, font: bold, color: rgb(0, 0, 0) });
    // details on the left, QR (full code) on the right
    const qs = Math.min(y - pad, 20 * MM);
    const full = rollBarcode(l.serial, l.invoice, l.batch);
    if (full !== l.serial && qs > 10 * MM) drawQR(page, full, { x: W - pad - qs, y: pad, size: qs, dpi });
    const textW = W - 2 * pad - (full !== l.serial ? qs + 2 * MM : 0);
    const fs = Math.max(6.5, Math.min(10, H / 17));
    y -= fs * 1.6;
    const line = (t: string, f = font, size = fs) => {
      if (y < pad) return;
      let s = t;
      while (s.length > 3 && f.widthOfTextAtSize(s, size) > textW) s = s.slice(0, -2);
      page.drawText(s, { x: pad, y, size, font: f, color: rgb(0, 0, 0) });
      y -= size * 1.3;
    };
    line(`${l.fabricNo} · ${l.fabric} ${l.colour}`.trim(), bold, fs * 1.1);
    line(`${fmtKg(l.weighedG, 1)} kg${l.sku ? ` · ${l.sku}` : ""}`, bold);
    if (l.invoice) line(`Invoice ${l.invoice}`);
    line(`Batch ${l.batch}${l.cutFrom ? ` · cut from ${l.cutFrom}` : ""}`);
  }
  return pdf.save();
}

export async function rackLabelsPdf(codes: string[], widthMm: number, heightMm: number, dpi = 203) {
  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = widthMm * MM, H = heightMm * MM, pad = 3 * MM;
  for (const c of codes) {
    const text = `RK-${c}`;
    const page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
    const bh = H * 0.5;
    drawCode128(page, text, { x: pad, y: H - pad - bh, maxW: W - 2 * pad, h: bh, dpi, center: true, maxModuleMm: 0.6 });
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
  drawCode128(page, t.to, { x: W - m - 220, y: y - 6, maxW: 220, h: 50, dpi: 300, maxModuleMm: 0.5 });
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
