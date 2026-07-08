import path from "path";
import { existsSync } from "fs";

/**
 * Reusable, company-agnostic PDFKit drawing helpers for the quote/contract
 * document. Layout (page size, columns, fonts) lives here; wording and
 * branding (company name, colors, contract text) come from
 * `@workspace/config` and are passed in by the caller.
 */

// ── Page constants ──────────────────────────────────────────────────────
export const PAGE_W = 612;
export const PAGE_H = 792;
export const ML = 36; // left margin
export const MR = 576; // right margin

// ── Table column X positions (left edge of each column) ─────────────────
// Total table width: 576 - 36 = 540pt
// Col widths: Item=35 | Desc=155 | PartNum=100 | Qty=30 | List=65 | Net=65 | Ext=90
export const TC = {
  item: 36, // 35pt wide
  desc: 71, // 155pt wide
  partNum: 226, // 100pt wide
  qty: 326, // 30pt wide
  listPrice: 356, // 65pt wide
  netPrice: 421, // 65pt wide
  extPrice: 486, // 90pt wide
  right: 576,
};

export const ROW_H = 20; // default row height
export const HDR_H = 28; // header row height (2-line labels)
export const FOOTER_Y = PAGE_H - 54;

export const FONT_REG = "Helvetica";
export const FONT_BOLD = "Helvetica-Bold";
export const FONT_OBL = "Helvetica-Oblique";

export const LOGO_W = 160;

export function logoHeight(aspectRatio: number): number {
  return Math.round(LOGO_W * aspectRatio);
}

// ── Logo path resolution (dev vs prod) ──────────────────────────────────
export function resolveLogoPath(fileName: string): string {
  const candidates = [
    path.join(process.cwd(), "src/data", fileName),
    path.join(process.cwd(), "artifacts/api-server/src/data", fileName),
    path.join(process.cwd(), "data", fileName),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

export function fmtDate(): string {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Cell border drawing helper ──────────────────────────────────────────
export function cellBorder(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  borderColor: string,
  fillColor?: string,
): void {
  if (fillColor) {
    doc.rect(x, y, w, h).fillColor(fillColor).fill();
  }
  doc.rect(x, y, w, h).strokeColor(borderColor).lineWidth(0.5).stroke();
}

// Draw one full table row: each cell gets a border, text is drawn inside
export function tableRow(
  doc: PDFKit.PDFDocument,
  y: number,
  rowH: number,
  itemNum: string,
  desc: string,
  partNum: string,
  qty: string,
  listPrice: string,
  netPrice: string,
  extPrice: string,
  textColor: string,
  borderColor: string,
  bold = false,
): void {
  const pad = 3; // inner padding

  cellBorder(doc, TC.item, y, TC.desc - TC.item, rowH, borderColor);
  cellBorder(doc, TC.desc, y, TC.partNum - TC.desc, rowH, borderColor);
  cellBorder(doc, TC.partNum, y, TC.qty - TC.partNum, rowH, borderColor);
  cellBorder(doc, TC.qty, y, TC.listPrice - TC.qty, rowH, borderColor);
  cellBorder(doc, TC.listPrice, y, TC.netPrice - TC.listPrice, rowH, borderColor);
  cellBorder(doc, TC.netPrice, y, TC.extPrice - TC.netPrice, rowH, borderColor);
  cellBorder(doc, TC.extPrice, y, TC.right - TC.extPrice, rowH, borderColor);

  const font = bold ? FONT_BOLD : FONT_REG;
  const ty = y + rowH / 2 - 5;

  doc.font(font).fontSize(9).fillColor(textColor);
  doc.text(itemNum, TC.item + pad, ty, { width: TC.desc - TC.item - pad * 2, align: "center" });
  doc.text(desc, TC.desc + pad, ty, { width: TC.partNum - TC.desc - pad * 2, align: "left" });
  doc.text(partNum, TC.partNum + pad, ty, { width: TC.qty - TC.partNum - pad * 2, align: "left" });
  doc.text(qty, TC.qty + pad, ty, { width: TC.listPrice - TC.qty - pad * 2, align: "center" });
  doc.text(listPrice, TC.listPrice + pad, ty, { width: TC.netPrice - TC.listPrice - pad * 2, align: "right" });
  doc.text(netPrice, TC.netPrice + pad, ty, { width: TC.extPrice - TC.netPrice - pad * 2, align: "right" });
  doc.text(extPrice, TC.extPrice + pad, ty, { width: TC.right - TC.extPrice - pad * 2, align: "right" });
}

// Draw the table header row (2-line labels, light gray bg)
export function tableHeader(
  doc: PDFKit.PDFDocument,
  y: number,
  textColor: string,
  borderColor: string,
  headerBackground: string,
): void {
  const pad = 3;

  cellBorder(doc, TC.item, y, TC.desc - TC.item, HDR_H, borderColor, headerBackground);
  cellBorder(doc, TC.desc, y, TC.partNum - TC.desc, HDR_H, borderColor, headerBackground);
  cellBorder(doc, TC.partNum, y, TC.qty - TC.partNum, HDR_H, borderColor, headerBackground);
  cellBorder(doc, TC.qty, y, TC.listPrice - TC.qty, HDR_H, borderColor, headerBackground);
  cellBorder(doc, TC.listPrice, y, TC.netPrice - TC.listPrice, HDR_H, borderColor, headerBackground);
  cellBorder(doc, TC.netPrice, y, TC.extPrice - TC.netPrice, HDR_H, borderColor, headerBackground);
  cellBorder(doc, TC.extPrice, y, TC.right - TC.extPrice, HDR_H, borderColor, headerBackground);

  // Line 1
  doc.font(FONT_BOLD).fontSize(9).fillColor(textColor);
  doc.text("Item", TC.item + pad, y + 4, { width: TC.desc - TC.item - pad * 2, align: "center" });
  doc.text("Description", TC.desc + pad, y + 4, { width: TC.partNum - TC.desc - pad * 2, align: "left" });
  doc.text("Product", TC.partNum + pad, y + 4, { width: TC.qty - TC.partNum - pad * 2, align: "left" });
  doc.text("Qty", TC.qty + pad, y + 4, { width: TC.listPrice - TC.qty - pad * 2, align: "center" });
  doc.text("List", TC.listPrice + pad, y + 4, { width: TC.netPrice - TC.listPrice - pad * 2, align: "right" });
  doc.text("Net", TC.netPrice + pad, y + 4, { width: TC.extPrice - TC.netPrice - pad * 2, align: "right" });
  doc.text("Ext. Price", TC.extPrice + pad, y + 4, { width: TC.right - TC.extPrice - pad * 2, align: "right" });

  // Line 2
  doc.text("", TC.item + pad, y + 16, { width: TC.desc - TC.item - pad * 2, align: "center" });
  doc.text("", TC.desc + pad, y + 16, { width: TC.partNum - TC.desc - pad * 2 });
  doc.text("Number", TC.partNum + pad, y + 16, { width: TC.qty - TC.partNum - pad * 2, align: "left" });
  doc.text("", TC.qty + pad, y + 16, { width: TC.listPrice - TC.qty - pad * 2 });
  doc.text("Price", TC.listPrice + pad, y + 16, { width: TC.netPrice - TC.listPrice - pad * 2, align: "right" });
  doc.text("Price", TC.netPrice + pad, y + 16, { width: TC.extPrice - TC.netPrice - pad * 2, align: "right" });
  doc.text("", TC.extPrice + pad, y + 16, { width: TC.right - TC.extPrice - pad * 2 });
}

// Draw the S&H + Total footer rows (merged label cell, value cell)
export function tableTotals(
  doc: PDFKit.PDFDocument,
  y: number,
  shippingLabel: string,
  totalLabel: string,
  totalValue: string,
  textColor: string,
  borderColor: string,
): number {
  const pad = 3;

  // S&H row: merged columns item..netPrice for label, extPrice for value
  const shLabelW = TC.netPrice - TC.item;
  cellBorder(doc, TC.item, y, shLabelW, ROW_H, borderColor);
  cellBorder(doc, TC.netPrice, y, TC.right - TC.netPrice, ROW_H, borderColor);
  doc.font(FONT_REG).fontSize(9).fillColor(textColor)
    .text(shippingLabel, TC.item + pad, y + ROW_H / 2 - 5, { width: shLabelW - pad * 2, align: "right" });
  // S&H value cell (blank in reference PDFs)
  y += ROW_H;

  // Total row
  const totLabelW = TC.extPrice - TC.item;
  cellBorder(doc, TC.item, y, totLabelW, ROW_H, borderColor);
  cellBorder(doc, TC.extPrice, y, TC.right - TC.extPrice, ROW_H, borderColor);
  doc.font(FONT_BOLD).fontSize(9).fillColor(textColor)
    .text(totalLabel, TC.item + pad, y + ROW_H / 2 - 5, { width: totLabelW - pad * 2, align: "right" });
  doc.font(FONT_BOLD).fontSize(9)
    .text(totalValue, TC.extPrice + pad, y + ROW_H / 2 - 5, { width: TC.right - TC.extPrice - pad * 2, align: "right" });
  y += ROW_H;

  return y;
}

// Identical footer on every page
export function drawFooter(
  doc: PDFKit.PDFDocument,
  footerLines: [string, string],
  textColor: string,
  borderColor: string,
): void {
  doc.moveTo(ML, FOOTER_Y).lineTo(MR, FOOTER_Y).strokeColor(borderColor).lineWidth(0.5).stroke();
  doc.font(FONT_REG).fontSize(8).fillColor(textColor)
    .text(footerLines[0], ML, FOOTER_Y + 5, { width: PAGE_W - ML * 2, align: "center" })
    .text(footerLines[1], ML, FOOTER_Y + 17, { width: PAGE_W - ML * 2, align: "center" });
}

// Logo + date on every page; optionally place QUOTE# box below logo on the right.
// Returns the Y coordinate where content should start.
export function drawPageHeader(
  doc: PDFKit.PDFDocument,
  dateStr: string,
  logoPath: string,
  logoAspectRatio: number,
  textColor: string,
  quoteNum?: string,
): number {
  const logoH = logoHeight(logoAspectRatio);
  if (existsSync(logoPath)) {
    doc.image(logoPath, ML, ML, { width: LOGO_W });
  }
  doc.font(FONT_REG).fontSize(10).fillColor(textColor)
    .text(dateStr, ML, ML, { width: PAGE_W - ML * 2, align: "right" });
  if (quoteNum) {
    const boxY = ML + logoH + 8;
    drawQuoteNumBox(doc, quoteNum, MR - 184, boxY, textColor);
    return boxY + 18 + 10;
  }
  return ML + logoH + 14;
}

// QUOTE# in a bordered rectangle (for quote page only)
export function drawQuoteNumBox(
  doc: PDFKit.PDFDocument,
  quoteNum: string,
  x: number,
  y: number,
  textColor: string,
): void {
  const text = `QUOTE#: ${quoteNum}`;
  const boxW = 180;
  const boxH = 18;
  doc.rect(x, y, boxW, boxH).strokeColor(textColor).lineWidth(0.8).stroke();
  doc.font(FONT_BOLD).fontSize(9).fillColor(textColor)
    .text(text, x + 4, y + 4, { width: boxW - 8, align: "left" });
}
