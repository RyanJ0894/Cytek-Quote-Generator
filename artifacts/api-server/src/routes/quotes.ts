import { Router, type IRouter, type Request, type Response } from "express";
import PDFDocument from "pdfkit";
import { DataSourceError, getDataSourceService } from "../data-sources/service.js";
import { footerLines, logoBuffer, quoteProfileStatus } from "../data-sources/quote-profile.js";
import {
  FONT_BOLD,
  FONT_REG,
  FOOTER_Y,
  HDR_H,
  ML,
  MR,
  PAGE_H,
  PAGE_W,
  ROW_H,
  drawFooter,
  drawPageHeader,
  drawQuoteNumBox,
  fmtDate,
  fmtMoney,
  tableHeader,
  tableRow,
  tableTotals,
} from "../lib/pdf.js";

const router: IRouter = Router();

interface QuoteLineItem {
  description: string;
  partNumber?: string;
  quantity: number;
  /** List price per unit. */
  unitPrice: number;
  /** Quote-specific discount, 0-100. */
  discountPercent?: number;
  /** Discounted price per unit; computed from discountPercent when absent. */
  netPrice?: number;
}

interface QuoteRequest {
  /** Data source whose Quote Profile brands the document; the default source when omitted. */
  dataSource?: string;
  customerName: string;
  accountName?: string;
  facilityName?: string;
  address?: string;
  serialNumber: string;
  contractType?: string;
  contractStatus?: string;
  productName?: string;
  serviceType?: string;
  servicePrice?: number;
  serviceDiscountPercent?: number;
  parts: QuoteLineItem[];
  shipping?: number;
  notes?: string;
}

function isQuoteRequest(body: unknown): body is QuoteRequest {
  return typeof body === "object" && body !== null;
}

const roundMoney = (n: number) => Math.round(n * 100) / 100;

/** Selling price per unit after a quote-specific percentage discount (0-100). */
export function applyDiscount(price: number, discountPercent: number | undefined): number {
  const pct = Math.min(100, Math.max(0, Number(discountPercent) || 0));
  return roundMoney((Number(price) || 0) * (1 - pct / 100));
}

/** Net price for a line: an explicit netPrice wins, else list less discount. */
export function lineNetPrice(item: { unitPrice: number; discountPercent?: number; netPrice?: number }): number {
  if (typeof item.netPrice === "number" && Number.isFinite(item.netPrice) && item.netPrice >= 0) {
    return roundMoney(item.netPrice);
  }
  return applyDiscount(item.unitPrice, item.discountPercent);
}

// ── Route handler ────────────────────────────────────────────────────────
router.post("/generate", async (req: Request, res: Response) => {
  try {
    if (!isQuoteRequest(req.body)) {
      res.status(400).json({ error: "Request body must be a JSON object." });
      return;
    }

    const data = req.body;

    // Branding comes from the active data source's Quote Profile — never
    // from another source and never from an application-wide default.
    const service = getDataSourceService();
    const source = await service.resolve(typeof data.dataSource === "string" ? data.dataSource : undefined);
    const profile = await service.getProfile(source.id);
    const status = quoteProfileStatus(profile);
    if (!profile || !status.complete) {
      res.status(400).json({
        error: `The Quote Profile for "${source.name}" is incomplete (missing: ${status.missing.join(", ")}). Complete it on the Data Sources page before generating quotes.`,
        missing: status.missing,
      });
      return;
    }
    const LOGO = profile.logo
      ? { image: logoBuffer(profile.logo), aspectRatio: profile.logo.aspectRatio }
      : { text: profile.shortName || profile.companyName };
    const FOOTER_LINES = footerLines(profile);
    const { textColor: TEXT_COLOR, borderColor: BORDER_COLOR, tableHeaderBackground: HEADER_BG } = profile.pdfTheme;

    const parts = Array.isArray(data.parts) ? data.parts : [];
    const dateStr = fmtDate();
    const quoteNum = `Q-${Date.now().toString().slice(-8)}`;

    const doc = new PDFDocument({
      margin: 0,
      size: "LETTER",
      autoFirstPage: true,
      bufferPages: true,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="quote-${data.serialNumber || "draft"}-${Date.now()}.pdf"`
    );
    doc.pipe(res);

    // ═══════════════════════════════════════════════════════════════
    // PAGE 1 — QUOTE
    // ═══════════════════════════════════════════════════════════════

    // ── Logo (top-left) + date (top-right) ──────────────────────
    let y = drawPageHeader(doc, dateStr, LOGO, TEXT_COLOR);

    // ── Customer block (left) ────────────────────────────────────
    const customerTopY = y; // save for QUOTE# box alignment

    doc.font(FONT_BOLD).fontSize(10).fillColor(TEXT_COLOR)
       .text(data.customerName || "", ML, y);
    y += 13;

    if (data.facilityName) {
      doc.font(FONT_REG).fontSize(10).text(data.facilityName, ML, y);
      y += 13;
    }

    if (data.address) {
      const addrLines = doc.heightOfString(data.address, { width: 250, align: "left" });
      doc.font(FONT_REG).fontSize(10).text(data.address, ML, y, { width: 250 });
      y += addrLines + 6;
    }

    // ── Equipment lines: instrument + serial number ──────────────
    if (data.productName) {
      doc.font(FONT_REG).fontSize(10).fillColor(TEXT_COLOR)
         .text(`Instrument: ${data.productName}`, ML, y, { width: 300 });
      y += 13;
    }
    if (data.serialNumber) {
      doc.font(FONT_REG).fontSize(10).fillColor(TEXT_COLOR)
         .text(`Serial Number: ${data.serialNumber}`, ML, y, { width: 300 });
      y += 13;
    }

    // ── QUOTE# boxed — right side, same level as customer name ──────────
    drawQuoteNumBox(doc, quoteNum, MR - 184, customerTopY, TEXT_COLOR);

    y += 12; // gap before table

    // ── Items table ──────────────────────────────────────────────
    tableHeader(doc, y, TEXT_COLOR, BORDER_COLOR, HEADER_BG);
    y += HDR_H;

    // Build all items
    const allItems: Array<{
      desc: string; partNum: string;
      qty: number; listPrice: number; netPrice: number;
    }> = [];

    if (data.serviceType && (data.servicePrice ?? 0) > 0) {
      allItems.push({
        desc: data.serviceType,
        partNum: "",
        qty: 1,
        listPrice: data.servicePrice ?? 0,
        netPrice: applyDiscount(data.servicePrice ?? 0, data.serviceDiscountPercent),
      });
    }

    for (const part of parts) {
      if (part.description) {
        allItems.push({
          desc: part.description,
          partNum: part.partNumber || "",
          qty: part.quantity || 1,
          listPrice: part.unitPrice || 0,
          netPrice: lineNetPrice(part),
        });
      }
    }

    let extTotal = 0;

    if (allItems.length === 0) {
      tableRow(doc, y, ROW_H, "", "No items.", "", "", "", "", "", TEXT_COLOR, BORDER_COLOR);
      y += ROW_H;
    } else {
      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];

        // Check if we need a new page
        if (y + ROW_H > FOOTER_Y - 60) {
          drawFooter(doc, FOOTER_LINES, TEXT_COLOR, BORDER_COLOR);
          doc.addPage({ margin: 0, size: "LETTER" });
          y = drawPageHeader(doc, dateStr, LOGO, TEXT_COLOR, quoteNum);
          tableHeader(doc, y, TEXT_COLOR, BORDER_COLOR, HEADER_BG);
          y += HDR_H;
        }

        // Extended price uses the discounted (net) price; the list price
        // column keeps showing the catalog price so the discount is visible.
        const ext = roundMoney(item.qty * item.netPrice);
        extTotal += ext;

        // Show net price only if different from list
        const netDisplay = (item.netPrice > 0 && item.netPrice !== item.listPrice)
          ? fmtMoney(item.netPrice)
          : "";

        tableRow(
          doc, y, ROW_H,
          String(i + 1),
          item.desc,
          item.partNum,
          String(item.qty),
          fmtMoney(item.listPrice),
          netDisplay,
          fmtMoney(ext),
          TEXT_COLOR,
          BORDER_COLOR
        );
        y += ROW_H;
      }
    }

    // ── S&H and Total rows ───────────────────────────────────────
    const shipping = Number(data.shipping) || 0;
    const total = roundMoney(extTotal + shipping);

    y = tableTotals(doc, y, "Shipping & Handling Estimate", "Total", fmtMoney(total), TEXT_COLOR, BORDER_COLOR);

    // ── Notes (user-entered, below table) ────────────────────────
    if (data.notes && data.notes.trim()) {
      y += 10;
      doc.font(FONT_REG).fontSize(9).fillColor(TEXT_COLOR)
         .text(`      ${data.notes.trim()}`, ML, y, { width: MR - ML });
      y += doc.heightOfString(data.notes.trim(), { width: MR - ML }) + 10;
    }

    y += 16;

    // ── Standard bullet points ────────────────────────────────────
    doc.font(FONT_REG).fontSize(9).fillColor(TEXT_COLOR);
    for (const b of profile.quoteBullets) {
      doc.text(b, ML, y, { width: MR - ML });
      y += 13;
    }

    drawFooter(doc, FOOTER_LINES, TEXT_COLOR, BORDER_COLOR);

    // ═══════════════════════════════════════════════════════════════
    // PAGE 2+ — TERMS AND CONDITIONS (only when the profile has any)
    // ═══════════════════════════════════════════════════════════════
    const { title: termsTitle, subtitle: termsSubtitle, intro: termsIntro, sections: termsSections } =
      profile.termsAndConditions;
    if (!termsIntro && termsSections.length === 0) {
      doc.end();
      return;
    }
    doc.addPage({ margin: 0, size: "LETTER" });

    // First T&C page: logo + date + QUOTE# box
    let ty = drawPageHeader(doc, dateStr, LOGO, TEXT_COLOR, quoteNum);

    // T&C title (centered)
    doc.font(FONT_BOLD).fontSize(11).fillColor(TEXT_COLOR)
       .text(termsTitle, ML, ty, { width: PAGE_W - ML * 2, align: "center" });
    ty += 16;
    doc.font(FONT_BOLD).fontSize(10)
       .text(termsSubtitle, ML, ty, { width: PAGE_W - ML * 2, align: "center" });
    ty += 16;

    // Helper: start a new T&C continuation page
    const newTCPage = () => {
      drawFooter(doc, FOOTER_LINES, TEXT_COLOR, BORDER_COLOR);
      doc.addPage({ margin: 0, size: "LETTER" });
      // Logo + date + QUOTE# box on every T&C continuation page
      ty = drawPageHeader(doc, dateStr, LOGO, TEXT_COLOR, quoteNum);
    };

    // Helper: ensure space or break page
    const ensureSpace = (needed: number) => {
      if (ty + needed > FOOTER_Y - 10) {
        newTCPage();
      }
    };

    // Opening paragraph
    const introH = doc.font(FONT_REG).fontSize(9.5).heightOfString(termsIntro, { width: PAGE_W - ML * 2 });
    ensureSpace(introH + 8);
    doc.font(FONT_REG).fontSize(9.5).fillColor(TEXT_COLOR)
       .text(termsIntro, ML, ty, { width: PAGE_W - ML * 2 });
    ty += introH + 10;

    // Numbered sections
    for (const sec of termsSections) {
      const paragraphs = sec.body.split("\n\n");

      // Measure the first paragraph (heading + first body para) together
      const firstParaText = `${sec.heading} ${paragraphs[0]}`;
      const firstParaH = doc.font(FONT_REG).fontSize(9.5).heightOfString(firstParaText, { width: PAGE_W - ML * 2 });

      ensureSpace(Math.min(firstParaH, 60));

      // Render heading (bold) continued into first paragraph (regular)
      doc.font(FONT_BOLD).fontSize(9.5).fillColor(TEXT_COLOR)
         .text(`${sec.heading} `, ML, ty, { width: PAGE_W - ML * 2, continued: true });
      doc.font(FONT_REG)
         .text(paragraphs[0], { continued: false });
      ty += firstParaH + 4;

      // Render remaining paragraphs in the same section
      for (let pi = 1; pi < paragraphs.length; pi++) {
        const paraH = doc.font(FONT_REG).fontSize(9.5).heightOfString(paragraphs[pi], { width: PAGE_W - ML * 2 });
        ensureSpace(paraH + 4);
        doc.font(FONT_REG).fontSize(9.5).fillColor(TEXT_COLOR)
           .text(paragraphs[pi], ML, ty, { width: PAGE_W - ML * 2 });
        ty += paraH + 4;
      }

      ty += 6; // inter-section gap
    }

    drawFooter(doc, FOOTER_LINES, TEXT_COLOR, BORDER_COLOR);
    doc.end();

  } catch (err) {
    if (err instanceof DataSourceError && !res.headersSent) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error("Error generating quote PDF:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate PDF. Please check your input and try again." });
    }
  }
});

export default router;
