/**
 * What a scanned code is. Safe for browser and server.
 *
 * Roll labels carry three parts in one Code 128 barcode:  SERIAL|INVOICE|BATCH
 *   e.g. 55A-4821|INV-2231|B-CT26PO48-55A-01
 * Old labels carry only the serial (55A-4821). Rack labels are RK-<code>, transfer orders TROR-/TROC-.
 * Anything else is treated as text: a Fabric #, an SKU (your printed SKU barcodes), a PO or an invoice number.
 */
export type RollPart = "serial" | "invoice" | "batch";
export type Want = RollPart | "sku" | "rack" | "to" | "po" | "any";
export type Parsed =
  | { kind: "roll"; serial: string; invoice: string | null; batch: string | null; raw: string }
  | { kind: "rack"; code: string; raw: string }
  | { kind: "to"; number: string; raw: string }
  | { kind: "text"; text: string; raw: string };

export const SEP = "|";
export const SERIAL_RE = /^\d+[A-Z]*-\d{4}$/;
export const TO_RE = /^TRO[RC]-\d{3,}$/;

export function parseCode(rawIn: string): Parsed {
  const raw = String(rawIn ?? "").trim();
  const up = raw.toUpperCase();
  // some scanners send the separator as a different character on non-US keyboard layouts
  const norm = up.replace(/[¦¦]/g, SEP);
  if (norm.includes(SEP)) {
    const [serial, invoice, batch] = norm.split(SEP).map((x) => x.trim());
    return { kind: "roll", serial, invoice: invoice || null, batch: batch || null, raw };
  }
  if (/^RK-/.test(norm)) return { kind: "rack", code: norm.slice(3), raw };
  if (TO_RE.test(norm)) return { kind: "to", number: norm, raw };
  if (SERIAL_RE.test(norm)) return { kind: "roll", serial: norm, invoice: null, batch: null, raw };
  return { kind: "text", text: norm, raw };
}

/** The barcode text printed on a roll label. */
export function rollBarcode(serial: string, invoice?: string | null, batch?: string | null) {
  if (!invoice && !batch) return serial;
  return [serial, invoice ?? "", batch ?? ""].join(SEP);
}

/** Pull the one part an input wants out of a scan. Returns an error message when the scan is the wrong kind of code. */
export function pick(rawIn: string, want: Want): { value: string; error?: string; parsed: Parsed } {
  const p = parseCode(rawIn);
  const bad = (m: string) => ({ value: "", error: m, parsed: p });
  switch (want) {
    case "serial":
      if (p.kind === "roll") return { value: p.serial, parsed: p };
      if (p.kind === "rack") return bad("That's a rack label. This box wants a roll label.");
      if (p.kind === "to") return bad("That's a transfer order. This box wants a roll label.");
      return { value: p.text, parsed: p }; // typed by hand
    case "invoice":
      if (p.kind === "roll") return p.invoice ? { value: p.invoice, parsed: p } : bad("This roll label has no invoice in it (old label).");
      return { value: p.kind === "text" ? p.text : p.raw.toUpperCase(), parsed: p };
    case "batch":
      if (p.kind === "roll") return p.batch ? { value: p.batch, parsed: p } : bad("This roll label has no batch in it (old label).");
      return { value: p.kind === "text" ? p.text : p.raw.toUpperCase(), parsed: p };
    case "sku":
      if (p.kind === "roll") return bad(`That's a roll label (${p.serial}). This box wants the fabric: scan the SKU barcode or type the Fabric #.`);
      if (p.kind === "rack") return bad("That's a rack label. This box wants the fabric SKU or Fabric #.");
      if (p.kind === "to") return bad("That's a transfer order. This box wants the fabric SKU or Fabric #.");
      return { value: p.text, parsed: p };
    case "rack":
      if (p.kind === "rack") return { value: p.code, parsed: p };
      return bad("This box wants a rack label (RK-…).");
    case "to":
      if (p.kind === "to") return { value: p.number, parsed: p };
      if (p.kind === "text" && /^\d+$/.test(p.text)) return { value: p.text, parsed: p };
      return bad("This box wants a transfer order barcode (TROR-…).");
    case "po":
      if (p.kind === "roll") return bad("That's a roll label. This box wants the fabric PO number.");
      return { value: p.kind === "text" ? p.text : p.raw.toUpperCase(), parsed: p };
    default:
      return { value: p.kind === "roll" ? p.serial : p.kind === "text" ? p.text : p.raw.toUpperCase(), parsed: p };
  }
}

/** Server side: accept a full roll label or a bare serial wherever a serial is expected. */
export const serialOf = (code: string) => { const p = parseCode(code); return p.kind === "roll" ? p.serial : String(code ?? "").trim().toUpperCase(); };

export const WANT_LABEL: Record<Want, string> = {
  serial: "roll serial", invoice: "invoice # from the roll label", batch: "batch from the roll label", sku: "fabric SKU / Fabric #",
  rack: "rack label", to: "transfer order", po: "fabric PO", any: "anything",
};
