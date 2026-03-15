import { Router, type IRouter, type Request, type Response } from "express";
import PDFDocument from "pdfkit";

const router: IRouter = Router();

interface QuoteLineItem {
  description: string;
  partNumber?: string;
  quantity: number;
  unitPrice: number;
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

// Column X positions (mirroring the Excel sheet layout)
// Usable width: 612 - 72 (margins) = 540pt
// Col C starts at 72, then: Item(30), Desc(165), PartNum(105), Qty(35), ListPrice(55), NetPrice(55), ExtPrice(60) + right padding
const COL = {
  item:      72,
  desc:      102,
  partNum:   267,
  qty:       372,
  listPrice: 407,
  netPrice:  462,
  extPrice:  517,
  right:     572,
};

const ROW_H = 18;
const HEADER_H = 20;

const NAVY   = "#003087";
const GRAY_BG = "#F2F2F2";
const GRAY_LINE = "#CCCCCC";
const BLACK  = "#1A1A1A";
const WHITE  = "#FFFFFF";
const DARK_GRAY = "#444444";

function fmt(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number): void {
  doc.rect(COL.item, y, COL.right - COL.item, HEADER_H).fillColor(NAVY).fill();
  doc.fillColor(WHITE).fontSize(8).font("Helvetica-Bold");
  doc.text("Item",           COL.item + 2,     y + 6, { width: COL.desc - COL.item - 4,     align: "center" });
  doc.text("Description",   COL.desc + 2,     y + 6, { width: COL.partNum - COL.desc - 4,   align: "left" });
  doc.text("Product Number", COL.partNum + 2,  y + 6, { width: COL.qty - COL.partNum - 4,    align: "left" });
  doc.text("Qty",            COL.qty + 2,      y + 6, { width: COL.listPrice - COL.qty - 4,  align: "center" });
  doc.text("List\nPrice",    COL.listPrice + 2, y + 6, { width: COL.netPrice - COL.listPrice - 4, align: "right" });
  doc.text("Net\nPrice",     COL.netPrice + 2,  y + 6, { width: COL.extPrice - COL.netPrice - 4, align: "right" });
  doc.text("Ext. Price",     COL.extPrice + 2,  y + 6, { width: COL.right - COL.extPrice - 4, align: "right" });
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  y: number,
  itemNum: number,
  desc: string,
  partNum: string,
  qty: number,
  listPrice: number,
  netPrice: number,
  extPrice: number,
  shade: boolean
): void {
  if (shade) {
    doc.rect(COL.item, y, COL.right - COL.item, ROW_H).fillColor(GRAY_BG).fill();
  }
  // Border
  doc.rect(COL.item, y, COL.right - COL.item, ROW_H).strokeColor(GRAY_LINE).lineWidth(0.4).stroke();
  // Vertical dividers
  for (const x of [COL.desc, COL.partNum, COL.qty, COL.listPrice, COL.netPrice, COL.extPrice]) {
    doc.moveTo(x, y).lineTo(x, y + ROW_H).strokeColor(GRAY_LINE).lineWidth(0.4).stroke();
  }

  doc.fillColor(BLACK).fontSize(8).font("Helvetica");
  doc.text(String(itemNum),       COL.item + 2,      y + 5, { width: COL.desc - COL.item - 4,     align: "center" });
  doc.text(desc,                  COL.desc + 3,      y + 5, { width: COL.partNum - COL.desc - 6,   align: "left" });
  doc.text(partNum || "",         COL.partNum + 3,   y + 5, { width: COL.qty - COL.partNum - 6,    align: "left" });
  doc.text(String(qty),           COL.qty + 2,       y + 5, { width: COL.listPrice - COL.qty - 4,  align: "center" });
  doc.text(fmt(listPrice),        COL.listPrice + 2, y + 5, { width: COL.netPrice - COL.listPrice - 4,  align: "right" });
  doc.text(fmt(netPrice),         COL.netPrice + 2,  y + 5, { width: COL.extPrice - COL.netPrice - 4,   align: "right" });
  doc.text(fmt(extPrice),         COL.extPrice + 2,  y + 5, { width: COL.right - COL.extPrice - 4,  align: "right" });
}

router.post("/generate", (req: Request, res: Response) => {
  try {
    const data = req.body as QuoteRequest;

    const quoteNum = `Q-${Date.now().toString().slice(-8)}`;
    const dateStr = new Date().toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });

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

    // ─────────────────────────────────────────────────────────────────
    // PAGE 1: QUOTE
    // ─────────────────────────────────────────────────────────────────

    // ── Top Header Bar ──────────────────────────────────────────────
    doc.rect(0, 0, 612, 58).fillColor(NAVY).fill();

    // Company name + subtitle
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(18)
       .text("CYTEK BIOSCIENCES", 36, 12);
    doc.fillColor("#A8C4E0").font("Helvetica").fontSize(9)
       .text("Service & Parts Quote", 36, 36);

    // Quote number & date (right side)
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(9)
       .text(`QUOTE #: ${quoteNum}`, 0, 14, { width: 576, align: "right" });
    doc.fillColor("#A8C4E0").font("Helvetica").fontSize(8)
       .text(`Date: ${dateStr}`, 0, 30, { width: 576, align: "right" });

    // ── Customer Information ─────────────────────────────────────────
    let y = 70;

    // Left block: customer
    doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK_GRAY)
       .text("BILL TO / CUSTOMER", 36, y);
    y += 13;

    doc.font("Helvetica-Bold").fontSize(10).fillColor(BLACK)
       .text(data.customerName || "—", 36, y);
    y += 14;

    if (data.facilityName) {
      doc.font("Helvetica").fontSize(9).fillColor(DARK_GRAY)
         .text(data.facilityName, 36, y);
      y += 13;
    }

    if (data.address) {
      doc.font("Helvetica").fontSize(9).fillColor(DARK_GRAY)
         .text(data.address, 36, y, { width: 300 });
      y += doc.heightOfString(data.address, { width: 300 }) + 4;
    }

    // Right block: quote details
    const detailY = 70;
    const detailX = 360;
    const labelW = 95;
    const valW = 155;

    const detailRow = (label: string, val: string, ry: number) => {
      doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK_GRAY)
         .text(label, detailX, ry, { width: labelW });
      doc.font("Helvetica").fontSize(8).fillColor(BLACK)
         .text(val || "—", detailX + labelW, ry, { width: valW });
    };

    let dy = detailY;
    detailRow("Serial Number:", data.serialNumber || "—", dy); dy += 13;
    detailRow("Contract Type:", data.contractType || "—", dy); dy += 13;
    if (data.productName) { detailRow("Instrument:", data.productName, dy); dy += 13; }
    if (data.accountName) { detailRow("Account:", data.accountName, dy); dy += 13; }

    // Divider line
    const divY = Math.max(y, dy) + 8;
    doc.moveTo(36, divY).lineTo(576, divY).strokeColor(NAVY).lineWidth(1).stroke();

    // ── Line Items Table ─────────────────────────────────────────────
    let tableY = divY + 10;

    drawTableHeader(doc, tableY);
    tableY += HEADER_H;

    // Build all line items
    const allItems: Array<{
      description: string;
      partNumber: string;
      quantity: number;
      unitPrice: number;
    }> = [];

    if (data.serviceType && (data.servicePrice ?? 0) > 0) {
      allItems.push({
        description: data.serviceType,
        partNumber: "",
        quantity: 1,
        unitPrice: data.servicePrice ?? 0,
      });
    }

    for (const part of data.parts || []) {
      if (part.description) {
        allItems.push({
          description: part.description,
          partNumber: part.partNumber || "",
          quantity: part.quantity || 1,
          unitPrice: part.unitPrice || 0,
        });
      }
    }

    let subtotal = 0;

    if (allItems.length === 0) {
      doc.rect(COL.item, tableY, COL.right - COL.item, ROW_H).fillColor(GRAY_BG).fill();
      doc.fillColor(DARK_GRAY).fontSize(8).font("Helvetica")
         .text("No items added", COL.desc, tableY + 5, { width: 200 });
      tableY += ROW_H;
    } else {
      allItems.forEach((item, i) => {
        if (tableY > 680) {
          doc.addPage({ margin: 0, size: "LETTER" });
          tableY = 50;
          drawTableHeader(doc, tableY);
          tableY += HEADER_H;
        }
        const ext = (item.quantity || 1) * (item.unitPrice || 0);
        subtotal += ext;
        drawTableRow(doc, tableY, i + 1, item.description, item.partNumber,
          item.quantity, item.unitPrice, item.unitPrice, ext, i % 2 === 1);
        tableY += ROW_H;
      });
    }

    // ── Shipping & Handling row ──────────────────────────────────────
    const shipping = data.shipping || 0;

    // S&H row (spans description through extPrice, italic)
    doc.rect(COL.item, tableY, COL.right - COL.item, ROW_H).fillColor(GRAY_BG).fill();
    doc.rect(COL.item, tableY, COL.right - COL.item, ROW_H).strokeColor(GRAY_LINE).lineWidth(0.4).stroke();
    doc.fillColor(DARK_GRAY).fontSize(8).font("Helvetica-Oblique")
       .text("Shipping & Handling Estimate", COL.desc + 3, tableY + 5, {
         width: COL.extPrice - COL.desc - 6, align: "left"
       });
    doc.font("Helvetica-Oblique")
       .text(fmt(shipping), COL.extPrice + 2, tableY + 5, {
         width: COL.right - COL.extPrice - 4, align: "right"
       });
    tableY += ROW_H;

    // ── TOTAL row ────────────────────────────────────────────────────
    const total = subtotal + shipping;

    doc.rect(COL.item, tableY, COL.right - COL.item, ROW_H + 2).fillColor(NAVY).fill();
    doc.fillColor(WHITE).fontSize(9).font("Helvetica-Bold")
       .text("TOTAL", COL.desc + 3, tableY + 5, {
         width: COL.extPrice - COL.desc - 6, align: "left"
       });
    doc.text(fmt(total), COL.extPrice + 2, tableY + 5, {
      width: COL.right - COL.extPrice - 4, align: "right"
    });
    tableY += ROW_H + 2 + 14;

    // ── Pre-Inspection / Recertification notice ──────────────────────
    doc.rect(36, tableY, 540, 22).fillColor("#FFF8E1").fill();
    doc.rect(36, tableY, 540, 22).strokeColor("#F0C040").lineWidth(0.6).stroke();
    doc.fillColor("#7A5C00").fontSize(8).font("Helvetica-Bold")
       .text("Pre-Inspection / Recertification:", 42, tableY + 7);
    doc.font("Helvetica").fillColor("#7A5C00")
       .text("A pre-inspection may be required prior to service. Cytek will notify the customer if additional assessment is needed.", 180, tableY + 7, { width: 390 });
    tableY += 30;

    // ── Notes ────────────────────────────────────────────────────────
    if (data.notes && data.notes.trim()) {
      tableY += 4;
      doc.fillColor(NAVY).fontSize(9).font("Helvetica-Bold")
         .text("NOTES", 36, tableY);
      doc.moveTo(36, tableY + 13).lineTo(576, tableY + 13)
         .strokeColor(NAVY).lineWidth(0.8).stroke();
      tableY += 18;
      doc.fillColor(BLACK).fontSize(8.5).font("Helvetica")
         .text(data.notes, 36, tableY, { width: 540 });
      tableY += doc.heightOfString(data.notes, { width: 540 }) + 8;
    }

    // ── Footer ───────────────────────────────────────────────────────
    const footY = 752 - 38;
    doc.moveTo(36, footY).lineTo(576, footY).strokeColor(GRAY_LINE).lineWidth(0.5).stroke();
    doc.fillColor(DARK_GRAY).fontSize(7).font("Helvetica")
       .text(
         "This quote is valid for 30 days from the date issued. Prices in USD and subject to change without notice. " +
         "Contact your Cytek Biosciences service representative with any questions.",
         36, footY + 6, { width: 540, align: "center" }
       );
    doc.fillColor(NAVY).fontSize(7).font("Helvetica-Bold")
       .text(`QUOTE #: ${quoteNum}  |  Page 1`, 0, footY + 17, { width: 576, align: "right" });

    // ─────────────────────────────────────────────────────────────────
    // PAGE 2: TERMS & CONDITIONS (Part 1)
    // ─────────────────────────────────────────────────────────────────
    doc.addPage({ margin: 0, size: "LETTER" });

    // Header band
    doc.rect(0, 0, 612, 42).fillColor(NAVY).fill();
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(13)
       .text("CYTEK BIOSCIENCES — TERMS AND CONDITIONS OF SERVICE", 36, 13);
    doc.fillColor("#A8C4E0").font("Helvetica").fontSize(8)
       .text(`Quote #: ${quoteNum}`, 0, 28, { width: 576, align: "right" });

    let ty = 56;
    const pageW = 540;
    const leftM = 36;

    const tcHeading = (title: string) => {
      ty += 4;
      doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9)
         .text(title, leftM, ty, { width: pageW });
      ty += 14;
    };

    const tcBody = (text: string) => {
      doc.fillColor(BLACK).font("Helvetica").fontSize(8.5)
         .text(text, leftM, ty, { width: pageW });
      ty += doc.heightOfString(text, { width: pageW }) + 7;
    };

    tcHeading("1. ACCEPTANCE");
    tcBody("This quotation constitutes an offer by Cytek Biosciences, Inc. ("Cytek") to provide the services and/or parts described herein. Customer's written acceptance, purchase order, or commencement of performance constitutes acceptance of these Terms and Conditions, which supersede any conflicting terms in Customer's purchase order or other documents.");

    tcHeading("2. PRICES AND PAYMENT");
    tcBody("All prices are in U.S. Dollars and are valid for thirty (30) days from the date of this quote, unless otherwise stated. Invoices are due and payable Net 30 days from the invoice date. Cytek reserves the right to assess a late payment charge of 1.5% per month on overdue balances. Customer is responsible for all applicable taxes, duties, and freight charges unless explicitly included in this quote.");

    tcHeading("3. SCOPE OF SERVICES");
    tcBody("Services are limited to those described in this quotation. Any additional labor, parts, or travel required due to conditions not apparent at the time of quoting will be identified and quoted separately before work proceeds. On-Site Support services are performed during standard Cytek business hours (Monday–Friday, 8 AM–5 PM local time, excluding holidays) unless an extended or emergency coverage agreement is in place.");

    tcHeading("4. CUSTOMER RESPONSIBILITIES");
    tcBody("Customer shall: (a) provide Cytek personnel with safe and timely access to the instrument and relevant facilities; (b) ensure that the instrument is in a safe operating condition prior to service; (c) designate a technically qualified representative to be present during all service visits; (d) retain backups of all data prior to any service work; and (e) promptly notify Cytek of any known hazardous conditions. Cytek is not responsible for data loss during or after service.");

    tcHeading("5. WARRANTY ON SERVICES AND PARTS");
    tcBody("Cytek warrants that services will be performed in a professional and workmanlike manner consistent with industry standards. Replacement parts supplied by Cytek carry a ninety (90) day warranty against defects in material and workmanship from the date of installation, unless otherwise stated. This warranty does not cover damage resulting from misuse, unauthorized modifications, use of non-Cytek approved consumables, or failure to follow Cytek's operating procedures.");

    tcHeading("6. LIMITATION OF LIABILITY");
    tcBody("CYTEK'S TOTAL LIABILITY FOR ANY CLAIM ARISING OUT OF OR RELATING TO THIS QUOTE OR ANY SERVICES PROVIDED HEREUNDER SHALL NOT EXCEED THE TOTAL AMOUNT PAID BY CUSTOMER FOR THE SPECIFIC SERVICE OR PARTS GIVING RISE TO THE CLAIM. IN NO EVENT SHALL CYTEK BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS OR DATA, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.");

    tcHeading("7. CANCELLATION AND RESCHEDULING");
    tcBody("Customer may cancel or reschedule a service visit with at least five (5) business days' written notice at no charge. Cancellations received less than five (5) business days prior to the scheduled date may be subject to a cancellation fee equal to one (1) day of on-site labor at the then-current list rate. Travel and lodging costs already incurred by Cytek at the time of cancellation are non-refundable.");

    // ── Page 2 Footer ────────────────────────────────────────────────
    doc.moveTo(36, footY).lineTo(576, footY).strokeColor(GRAY_LINE).lineWidth(0.5).stroke();
    doc.fillColor(DARK_GRAY).fontSize(7).font("Helvetica")
       .text("Cytek Biosciences, Inc.  ·  47215 Lakeview Blvd, Fremont, CA 94538  ·  www.cytekbio.com", 36, footY + 6, { width: pageW, align: "center" });
    doc.fillColor(NAVY).fontSize(7).font("Helvetica-Bold")
       .text(`QUOTE #: ${quoteNum}  |  Page 2`, 0, footY + 17, { width: 576, align: "right" });

    // ─────────────────────────────────────────────────────────────────
    // PAGE 3: TERMS & CONDITIONS (Part 2) + Signature Block
    // ─────────────────────────────────────────────────────────────────
    doc.addPage({ margin: 0, size: "LETTER" });

    doc.rect(0, 0, 612, 42).fillColor(NAVY).fill();
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(13)
       .text("CYTEK BIOSCIENCES — TERMS AND CONDITIONS (CONTINUED)", 36, 13);
    doc.fillColor("#A8C4E0").font("Helvetica").fontSize(8)
       .text(`Quote #: ${quoteNum}`, 0, 28, { width: 576, align: "right" });

    ty = 56;

    tcHeading("8. FORCE MAJEURE");
    tcBody("Cytek shall not be liable for any delay or failure to perform due to causes beyond its reasonable control, including but not limited to acts of God, natural disasters, government actions, pandemics, labor disputes, supply chain disruptions, or carrier delays. In such events, Cytek will notify Customer as soon as reasonably practicable and work to reschedule services at the earliest feasible date.");

    tcHeading("9. INTELLECTUAL PROPERTY");
    tcBody("All service documentation, procedures, software, firmware, and related materials provided by Cytek remain the exclusive intellectual property of Cytek Biosciences, Inc. Customer is granted a limited, non-transferable license to use such materials solely for the purpose of operating the instrument serviced under this quote. No rights are granted to reproduce, modify, reverse-engineer, or distribute any Cytek proprietary materials.");

    tcHeading("10. CONFIDENTIALITY");
    tcBody("Each party agrees to treat as confidential any proprietary or non-public information disclosed by the other party in connection with services under this quote, and to use such information solely for purposes of fulfilling obligations hereunder. This obligation survives termination of services for a period of three (3) years.");

    tcHeading("11. GOVERNING LAW AND DISPUTE RESOLUTION");
    tcBody("These Terms and Conditions are governed by the laws of the State of California, without regard to its conflict of law principles. Any dispute arising from or related to these Terms shall first be subject to good-faith negotiation. If unresolved within thirty (30) days, disputes shall be submitted to binding arbitration in Alameda County, California, administered by JAMS in accordance with its then-current rules.");

    tcHeading("12. ENTIRE AGREEMENT");
    tcBody("These Terms and Conditions, together with the quote to which they are attached, constitute the entire agreement between the parties with respect to the subject matter hereof and supersede all prior negotiations, representations, or agreements, whether oral or written. No modification of these Terms shall be binding unless made in writing and signed by authorized representatives of both parties. The invalidity or unenforceability of any provision shall not affect the remaining provisions.");

    // ── Acceptance Signature Block ───────────────────────────────────
    ty += 10;
    doc.rect(leftM, ty, pageW, 0.8).fillColor(NAVY).fill();
    ty += 10;
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10)
       .text("CUSTOMER ACCEPTANCE", leftM, ty);
    ty += 14;
    doc.fillColor(BLACK).font("Helvetica").fontSize(8.5)
       .text("By signing below, Customer acknowledges receipt of this quotation and agrees to the Terms and Conditions stated herein.", leftM, ty, { width: pageW });
    ty += 24;

    const sigColW = 240;
    const sigGap = 60;
    const sigLineY = ty + 28;

    // Left sig block
    doc.moveTo(leftM, sigLineY).lineTo(leftM + sigColW, sigLineY).strokeColor(BLACK).lineWidth(0.7).stroke();
    doc.fillColor(DARK_GRAY).font("Helvetica").fontSize(8)
       .text("Authorized Customer Signature", leftM, sigLineY + 4);
    doc.moveTo(leftM, sigLineY + 22).lineTo(leftM + sigColW, sigLineY + 22).strokeColor(BLACK).lineWidth(0.7).stroke();
    doc.text("Print Name / Title", leftM, sigLineY + 26);
    doc.moveTo(leftM, sigLineY + 44).lineTo(leftM + sigColW, sigLineY + 44).strokeColor(BLACK).lineWidth(0.7).stroke();
    doc.text("Date", leftM, sigLineY + 48);

    // Right sig block
    const r2 = leftM + sigColW + sigGap;
    doc.moveTo(r2, sigLineY).lineTo(r2 + sigColW, sigLineY).strokeColor(BLACK).lineWidth(0.7).stroke();
    doc.fillColor(DARK_GRAY).font("Helvetica").fontSize(8)
       .text("Cytek Biosciences Representative", r2, sigLineY + 4);
    doc.moveTo(r2, sigLineY + 22).lineTo(r2 + sigColW, sigLineY + 22).strokeColor(BLACK).lineWidth(0.7).stroke();
    doc.text("Print Name / Title", r2, sigLineY + 26);
    doc.moveTo(r2, sigLineY + 44).lineTo(r2 + sigColW, sigLineY + 44).strokeColor(BLACK).lineWidth(0.7).stroke();
    doc.text("Date", r2, sigLineY + 48);

    // PO Number line
    ty = sigLineY + 68;
    doc.moveTo(leftM, ty).lineTo(leftM + sigColW, ty).strokeColor(BLACK).lineWidth(0.7).stroke();
    doc.fillColor(DARK_GRAY).font("Helvetica").fontSize(8)
       .text("Customer Purchase Order Number", leftM, ty + 4);

    // ── Page 3 Footer ────────────────────────────────────────────────
    doc.moveTo(36, footY).lineTo(576, footY).strokeColor(GRAY_LINE).lineWidth(0.5).stroke();
    doc.fillColor(DARK_GRAY).fontSize(7).font("Helvetica")
       .text("Cytek Biosciences, Inc.  ·  47215 Lakeview Blvd, Fremont, CA 94538  ·  www.cytekbio.com", 36, footY + 6, { width: pageW, align: "center" });
    doc.fillColor(NAVY).fontSize(7).font("Helvetica-Bold")
       .text(`QUOTE #: ${quoteNum}  |  Page 3`, 0, footY + 17, { width: 576, align: "right" });

    doc.end();
  } catch (err) {
    console.error("Error generating quote PDF:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate PDF" });
    }
  }
});

export default router;
