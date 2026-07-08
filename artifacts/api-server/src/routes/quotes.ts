import { Router, type IRouter, type Request, type Response } from "express";
import PDFDocument from "pdfkit";
import { activeCompany, getFooterLines } from "@workspace/config";
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
  resolveLogoPath,
  tableHeader,
  tableRow,
  tableTotals,
} from "../lib/pdf.js";

const router: IRouter = Router();

const LOGO_PATH = resolveLogoPath(activeCompany.logo.fileName);
const FOOTER_LINES = getFooterLines(activeCompany);
const { textColor: TEXT_COLOR, borderColor: BORDER_COLOR, tableHeaderBackground: HEADER_BG } =
  activeCompany.pdfTheme;

interface QuoteLineItem {
  description: string;
  partNumber?: string;
  quantity: number;
  unitPrice: number;
  netPrice?: number;
}

interface QuoteRequest {
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
  parts: QuoteLineItem[];
  shipping?: number;
  notes?: string;
}

function isQuoteRequest(body: unknown): body is QuoteRequest {
  return typeof body === "object" && body !== null;
}

// ── Route handler ────────────────────────────────────────────────────────
router.post("/generate", (req: Request, res: Response) => {
  try {
    if (!isQuoteRequest(req.body)) {
      res.status(400).json({ error: "Request body must be a JSON object." });
      return;
    }

    const data = req.body;
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
    let y = drawPageHeader(doc, dateStr, LOGO_PATH, activeCompany.logo.aspectRatio, TEXT_COLOR);

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
        netPrice: data.servicePrice ?? 0,
      });
    }

    for (const part of parts) {
      if (part.description) {
        allItems.push({
          desc: part.description,
          partNum: part.partNumber || "",
          qty: part.quantity || 1,
          listPrice: part.unitPrice || 0,
          netPrice: part.netPrice ?? part.unitPrice ?? 0,
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
          y = drawPageHeader(doc, dateStr, LOGO_PATH, activeCompany.logo.aspectRatio, TEXT_COLOR, quoteNum);
          tableHeader(doc, y, TEXT_COLOR, BORDER_COLOR, HEADER_BG);
          y += HDR_H;
        }

        const ext = item.qty * item.listPrice;
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
    const shipping = data.shipping || 0;
    const total = extTotal + shipping;

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
    for (const b of activeCompany.quoteBullets) {
      doc.text(b, ML, y, { width: MR - ML });
      y += 13;
    }

    drawFooter(doc, FOOTER_LINES, TEXT_COLOR, BORDER_COLOR);

    // ═══════════════════════════════════════════════════════════════
    // PAGE 2+ — TERMS AND CONDITIONS
    // ═══════════════════════════════════════════════════════════════
    doc.addPage({ margin: 0, size: "LETTER" });

    const { title: termsTitle, subtitle: termsSubtitle, intro: termsIntro, sections: termsSections } =
      activeCompany.termsAndConditions;

    // First T&C page: logo + date + QUOTE# box
    let ty = drawPageHeader(doc, dateStr, LOGO_PATH, activeCompany.logo.aspectRatio, TEXT_COLOR, quoteNum);

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
      ty = drawPageHeader(doc, dateStr, LOGO_PATH, activeCompany.logo.aspectRatio, TEXT_COLOR, quoteNum);
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
    console.error("Error generating quote PDF:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate PDF. Please check your input and try again." });
    }
  }
});

export default router;
