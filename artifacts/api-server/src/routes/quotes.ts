import { Router, type IRouter, type Request, type Response } from "express";
import PDFDocument from "pdfkit";

const router: IRouter = Router();

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

// ── Layout constants ────────────────────────────────────────────────────
const PAGE_W = 612;
const PAGE_H = 792;
const L = 72;   // left margin for customer block / table
const R = 576;  // right margin
const BODY_W = R - L; // 504

// Table column X positions (all relative to page left)
const TC = {
  item:      L,
  desc:      L + 40,
  partNum:   L + 220,
  qty:       L + 330,
  listPrice: L + 365,
  netPrice:  L + 430,
  extPrice:  L + 490,
  right:     R,
};

const FOOTER_Y = PAGE_H - 52;

const FONT_REG  = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";

function fmtDate(): string {
  const now = new Date();
  return `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Draw the identical footer that appears on every page of the reference PDFs
function drawFooter(doc: PDFKit.PDFDocument): void {
  const fy = FOOTER_Y;
  doc.moveTo(36, fy).lineTo(R, fy).strokeColor("#000000").lineWidth(0.5).stroke();
  doc.font(FONT_REG).fontSize(8).fillColor("#000000")
     .text(
       "Cytek Biosciences Inc. | Offices in Fremont, CA 94538. 47215 Lakeview Blvd",
       36, fy + 6, { width: PAGE_W - 72, align: "center" }
     );
  doc.text(
    "Phone: (510) 657-0102 | Fax: (510) 657-0151 | www.cytekbio.com | email: technical.support@cytekbio.com",
    36, fy + 18, { width: PAGE_W - 72, align: "center" }
  );
}

// Draw date top-right (matches reference exactly)
function drawDate(doc: PDFKit.PDFDocument, dateStr: string): void {
  doc.font(FONT_REG).fontSize(10).fillColor("#000000")
     .text(dateStr, 36, 36, { width: PAGE_W - 72, align: "right" });
}

// ── T&C text blocks ──────────────────────────────────────────────────────
// Exact language from Cytek's official Time & Materials quotation documents
const TC_INTRO = `These general terms and conditions (along with the quotation, "Terms") apply to the purchase of time and/materials by the customer ("Customer", "Purchaser", "Buyer", also "you" or "your") listed on the attached "quotation" and Cytek Biosciences, Inc. ("Cytek", also "our," "we" or "us").`;

const TC_SECTIONS: Array<{ heading: string; body: string }> = [
  {
    heading: "1. QUOTATIONS; APPLICABILITY OF TERMS:",
    body: `The attached quotation is valid if Cytek receives your purchase order referencing the quotation number prior to the date indicated on the quotation. Cytek may withdraw the quotation any time before that date upon notice to you or before shipment if an event occurs that is outside our control and makes it commercially impractical for Cytek to fulfill the order. The prices and other terms are contingent on you accepting all the terms and conditions on the quotation without exception. Your issuance of a purchase order for any of the products or services referencing the quotation number or at the prices indicated in the quotation will be your indication to Cytek that you agree to these Terms without exception and the Terms will become the entire agreement between you and Cytek for the products and services ordered.`,
  },
  {
    heading: "2. PAYMENT TERMS:",
    body: `Terms are net 30 days from date of invoice for credit-approved domestic accounts. International accounts may be created by arrangement. Payment may be made by credit card for up to US$10,000 maximum. Cytek shall have the right to receive payment in advance when it deems necessary. If you fail to pay any invoice when due, Cytek may also apply a late payment charge equal to the lesser of one percent (1%), or the maximum permissible rate under applicable law, per month on the outstanding balance. Cytek may delay shipment or suspend performance under any agreement if payment under any agreement or order between you and Cytek is not received when due or is rescinded. All payments should be made to: Cytek Biosciences Inc., Wells Fargo Bank, 420 Montgomery Street, San Francisco, CA 94104, USA. For wire transfer: ACH Routing # 121042882, Account # 1923229718, SWIFT WFBIUS6S or please contact ar@cytekbio.com.`,
  },
  {
    heading: "3. PRICING:",
    body: `In addition to the stated prices, you must pay for all taxes and fees imposed on the sale or use of the products and any other governmental charges imposed on Cytek relating to the products and all shipping and handling, freight, insurance, and other services. All prices are in USD unless otherwise noted. Third-party providers are charged a 15% administrative fee; added to the total invoice.`,
  },
  {
    heading: "4. SHIPMENT; DELIVERY; ACCEPTANCE; RETURNS:",
    body: `Unless expressly specified on the Quotation, all products shipped internationally will be Carriage and Insurance Paid (CIP Incoterms 2020). US domestic shipments will be Free On-Board Origin (F.O.B. Origin Incoterms 2020). Both will be prepaid by Cytek and added to the invoice. Any taxes and duties required to complete delivery will be the responsibility of the Customer. Risk of loss with respect to all products will pass from Cytek to Customer upon shipment. Cytek will ship the Products within a reasonable time after Cytek receives your purchase order, or if the Quotation states a proposed shipment date, on or around such date. Cytek will endeavor to meet any delivery date specified in any purchase order but is not liable for failing to meet the delivery date. You must report to Cytek, in writing, any claims for missing or defective products within 30 days from your receipt of them. Defective products will be addressed according to the warranty provisions. Product returns will be accepted at Cytek's discretion under its Returned Materials Authorization (RMA) policy and may be subject to a restocking fee.`,
  },
  {
    heading: "5. CANCELLATION:",
    body: `Cancelled orders will be subject to a cancellation charge to cover any finished goods, work in process and non-cancellable non-returnable materials, labor costs and expenses incurred by Cytek in good faith to fulfill the purchase order prior to the cancellation.`,
  },
  {
    heading: "6. LIMITED WARRANTY AND DISCLAIMER:",
    body: `Cytek warrants that services will be performed in a workmanlike manner and products will be free of defects only as set forth below. Cytek's warranty does not apply to defects resulting from product misuse, abuse, neglect or operator negligence. If a product defect is discovered and verified by Cytek's investigation under normal and proper use during the applicable warranty period, Cytek will, at its option, and without charge correct the defect either by (i) repair during normal business hours, (ii) replacement with an equivalent product, or (iii) refund the purchase price paid by you. If required as set forth below, you must ship the defective product to Cytek, transportation charges prepaid. The original warranty period will continue to be in effect on any repaired or replaced products. If Cytek replaces any part under this warranty or as a result of any services performed, Cytek will own the replaced part. If a third party manufactured product is supplied to you pursuant to the quotation, Cytek assigns to you any rights that may exist under the warranty provided by the manufacturer, but Cytek does not warrant the performance of the third party manufactured product or provide any remedy for failure of the third-party product to perform.\n\nTHE WARRANTIES IN THIS SECTION ARE PROVIDED IN LIEU OF ALL OTHER WARRANTIES, EXPRESS OR IMPLIED, AND ARE YOUR EXCLUSIVE REMEDIES RELATING TO PERFORMANCE OF THE PRODUCTS AND SERVICES. CYTEK DISCLAIMS ALL OTHER WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTY ABOUT THE MERCHANTABILITY OF THE PRODUCTS OR THEIR FITNESS FOR A PARTICULAR PURPOSE. IF ANY IMPLIED WARRANTIES APPLY AS A MATTER OF LAW, THEY ARE LIMITED IN DURATION TO WARRANTY PERIOD SPECIFIED IN THIS SECTION.\n\nA. Refurbished flow cytometer systems. The purchase of a refurbished flow cytometer system will be covered by warranty for defects in materials and workmanship for a period of 90 days from installation and such warranty will cover costs for travel, labor and parts (the "service warranty"). Parts purchased for use with refurbished flow cytometer systems will be covered by warranty for defects for a period of one year from the date of installation (the "parts warranty"). If a service engineer is dispatched on-site after expiration of the service warranty period but during the parts warranty period, travel and labor charges will apply. Consumable items are not covered by this warranty.\n\nB. Upgraded flow cytometer systems. In connection with an upgrade of a flow cytometer system, the upgraded portion of the flow cytometer is covered by warranty for defects in materials and workmanship for a period of one year from upgrade installation (the "upgrade warranty"). Defective parts replaced under the upgrade warranty must be returned to Cytek and shall be the property of Cytek. Service visits not associated with the upgrade warranty will be charged at the prevailing rate.\n\nC. New and refurbished accessories. The purchase of new or refurbished flow cytometer accessories are covered by warranty for defects in materials and workmanship under Cytek's depot level warranty for a period of one year from shipment. The warranty includes all parts and labor provided that all work will be performed at Cytek's Fremont, California facility. You must ship the defective product to Cytek, transportation charges prepaid.\n\nD. Billable repair services. Cytek warrants that the services performed will be in a professional workman-like manner and shall conform to the standards of the industry to include the manufacturer's quality control protocol. Billable repair services are covered by warranty for defects in workmanship for a period of 30 days from the date service is rendered. Cytek's sole liability under this warranty is limited to re-servicing of the instrument(s) or at Cytek's option, return of the sum paid for such services.\n\nE. New and used replacement parts. The purchase of new and used replacement parts are covered by warranty from defects in materials and workmanship for a period of 30 days from installation. Parts marked as service returnable items have an "S" at the end of the part number and must be returned to Cytek within 14 days after receipt of the replacement part or the customer will be charged the non-exchange rate. Restocking fee for usable parts is 20%.`,
  },
  {
    heading: "7. COMPUTER SUPPORT POLICY:",
    body: `Cytek's computer support policy provides support for only the software and hardware required for system operation, which is referred to as the "basic flow cytometer system". Cytek does not guaranty the system will function if any additional hardware or software is used, including networking hardware and software. If the system fails to meet Cytek's specifications, then Cytek may, at its option, remove hardware and uninstall software in order to return the basic flow cytometer system to its original installed operational configuration. It is the responsibility of the customer to backup all data on the basic flow cytometer computer system.`,
  },
  {
    heading: "8. INDEMNITY BY CYTEK:",
    body: `Cytek agrees to indemnify and hold harmless the Buyer from any and all claims, demands, suits, and expenses by reason of injury or death of any person(s) or damage to any property (except as excluded hereafter) solely and directly attributable to the negligent acts or negligent omissions of Cytek, its agents or employees while on the premises of the Buyer and arising out of services provided herein. Cytek maintains product and general liability insurance policies. If Buyer wishes to be named an Additional Insured on Cytek's product and/or general liability policy, an additional 5% charge will be added to the total purchase price.`,
  },
  {
    heading: "9. LIMITATION OF LIABILITY:",
    body: `Except as provided in Section 8, Cytek's liability will be limited to direct damages not to exceed the amount paid by you to Cytek under this agreement. Cytek will not be responsible for any damages resulting from delayed shipment.\n\nAny action arising out of these Terms may be brought by you up to one year after the date of the actionable cause.`,
  },
];

router.post("/generate", (req: Request, res: Response) => {
  try {
    const data = req.body as QuoteRequest;
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

    // Date top-right
    drawDate(doc, dateStr);

    // ── Customer Block (left) + Quote # (right) ──────────────────
    let y = 100;

    // Customer name (bold)
    doc.font(FONT_BOLD).fontSize(10).fillColor("#000000")
       .text(data.customerName || "", L, y);

    // QUOTE# aligned right on the same line
    doc.font(FONT_REG).fontSize(10)
       .text(`QUOTE#: ${quoteNum}`, 36, y, { width: PAGE_W - 72, align: "right" });

    y += 14;

    // Facility / company
    if (data.facilityName) {
      doc.font(FONT_REG).fontSize(10).text(data.facilityName, L, y);
      y += 13;
    }

    // Address (may be multi-line)
    if (data.address) {
      const addrH = doc.heightOfString(data.address, { width: 240, align: "left" });
      doc.font(FONT_REG).fontSize(10)
         .text(data.address, L, y, { width: 240 });
      y += addrH + 4;
    }

    y += 20; // gap before table

    // ── Table Headers ────────────────────────────────────────────
    doc.font(FONT_REG).fontSize(9).fillColor("#000000");

    // Header row line 1
    doc.text("Item",         TC.item,      y, { width: TC.desc - TC.item - 4,      align: "left" });
    doc.text("Description",  TC.desc,      y, { width: TC.partNum - TC.desc - 4,   align: "left" });
    doc.text("Product",      TC.partNum,   y, { width: TC.qty - TC.partNum - 4,    align: "left" });
    doc.text("Qty",          TC.qty,       y, { width: TC.listPrice - TC.qty - 4,  align: "center" });
    doc.text("List",         TC.listPrice, y, { width: TC.netPrice - TC.listPrice - 4, align: "right" });
    doc.text("Net",          TC.netPrice,  y, { width: TC.extPrice - TC.netPrice - 4,  align: "right" });
    doc.text("Ext. Price",   TC.extPrice,  y, { width: TC.right - TC.extPrice,     align: "right" });
    y += 11;

    // Header row line 2 (sub-labels)
    doc.text("",             TC.item,      y, { width: TC.desc - TC.item - 4 });
    doc.text("",             TC.desc,      y, { width: TC.partNum - TC.desc - 4 });
    doc.text("Number",       TC.partNum,   y, { width: TC.qty - TC.partNum - 4,    align: "left" });
    doc.text("",             TC.qty,       y, { width: TC.listPrice - TC.qty - 4 });
    doc.text("Price",        TC.listPrice, y, { width: TC.netPrice - TC.listPrice - 4, align: "right" });
    doc.text("Price",        TC.netPrice,  y, { width: TC.extPrice - TC.netPrice - 4,  align: "right" });
    y += 11;

    // Thin horizontal rule under headers
    doc.moveTo(L, y).lineTo(R, y).strokeColor("#000000").lineWidth(0.5).stroke();
    y += 8;

    // ── Line Items ───────────────────────────────────────────────
    const allItems: Array<{ desc: string; partNum: string; qty: number; listPrice: number; netPrice: number }> = [];

    if (data.serviceType && (data.servicePrice ?? 0) > 0) {
      allItems.push({
        desc: data.serviceType,
        partNum: "",
        qty: 1,
        listPrice: data.servicePrice ?? 0,
        netPrice: data.servicePrice ?? 0,
      });
    }

    for (const part of data.parts || []) {
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
      doc.font(FONT_REG).fontSize(9).fillColor("#000000")
         .text("No items.", TC.desc, y);
      y += 14;
    } else {
      allItems.forEach((item, i) => {
        if (y > FOOTER_Y - 60) {
          drawFooter(doc);
          doc.addPage({ margin: 0, size: "LETTER" });
          drawDate(doc, dateStr);
          doc.font(FONT_REG).fontSize(10).fillColor("#000000")
             .text(`QUOTE#: ${quoteNum}`, 36, 36, { width: PAGE_W - 72, align: "right" });
          y = 70;
        }

        const ext = item.qty * item.listPrice;
        extTotal += ext;

        doc.font(FONT_REG).fontSize(9).fillColor("#000000");
        // Item number centered
        doc.text(String(i + 1), TC.item, y, { width: TC.desc - TC.item - 4, align: "center" });
        // Description (may wrap)
        const descH = doc.heightOfString(item.desc, { width: TC.partNum - TC.desc - 6, align: "left" });
        doc.text(item.desc,         TC.desc,      y, { width: TC.partNum - TC.desc - 6,   align: "left" });
        doc.text(item.partNum,      TC.partNum,   y, { width: TC.qty - TC.partNum - 4,    align: "left" });
        doc.text(String(item.qty),  TC.qty,       y, { width: TC.listPrice - TC.qty - 4,  align: "center" });
        doc.text(fmtMoney(item.listPrice), TC.listPrice, y, { width: TC.netPrice - TC.listPrice - 4, align: "right" });
        // Net price: show only if different from list price and > 0; otherwise blank
        if (item.netPrice > 0 && item.netPrice !== item.listPrice) {
          doc.text(fmtMoney(item.netPrice), TC.netPrice, y, { width: TC.extPrice - TC.netPrice - 4, align: "right" });
        }
        doc.text(fmtMoney(ext), TC.extPrice, y, { width: TC.right - TC.extPrice, align: "right" });

        y += Math.max(descH, 13) + 4;
      });
    }

    y += 8;

    // ── Shipping & Handling + Total ──────────────────────────────
    const shipping = data.shipping || 0;
    const total = extTotal + shipping;

    // S&H line: right-aligned label, no dollar amount (matching reference)
    doc.font(FONT_REG).fontSize(9).fillColor("#000000")
       .text("Shipping & Handling Estimate", TC.listPrice, y, {
         width: TC.right - TC.listPrice, align: "right"
       });
    y += 13;

    // Total line: label + value
    doc.text("Total", TC.listPrice, y, {
      width: TC.extPrice - TC.listPrice - 4, align: "right"
    });
    doc.text(fmtMoney(total), TC.extPrice, y, {
      width: TC.right - TC.extPrice, align: "right"
    });
    y += 20;

    // ── Notes (user-entered — e.g. "Pre-Inspection/Recertification") ──
    if (data.notes && data.notes.trim()) {
      doc.font(FONT_REG).fontSize(9).fillColor("#000000")
         .text(`      ${data.notes.trim()}`, L, y, { width: BODY_W });
      y += doc.heightOfString(data.notes.trim(), { width: BODY_W }) + 14;
    }

    y += 14;

    // ── Standard bullet points (always present, matching reference) ──
    const bullets = [
      "-All prices in USD",
      "-The above quotation does not include any applicable sales tax.",
      "-Cytek will confirm order receipt and estimated ship date.",
      "-This quote is valid for 60 days.",
    ];
    doc.font(FONT_REG).fontSize(9).fillColor("#000000");
    for (const b of bullets) {
      doc.text(b, L, y, { width: BODY_W });
      y += 13;
    }

    drawFooter(doc);

    // ═══════════════════════════════════════════════════════════════
    // PAGE 2+ — GENERAL TERMS AND CONDITIONS OF SALE
    // ═══════════════════════════════════════════════════════════════
    doc.addPage({ margin: 0, size: "LETTER" });

    let ty = 36;
    let firstTCPage = true;

    const ensureSpace = (needed: number) => {
      if (ty + needed > FOOTER_Y - 10) {
        drawFooter(doc);
        doc.addPage({ margin: 0, size: "LETTER" });
        ty = 36;
        // Date + quote number on continuation pages
        drawDate(doc, dateStr);
        doc.font(FONT_REG).fontSize(10).fillColor("#000000")
           .text(`QUOTE#: ${quoteNum}`, 36, 36, { width: PAGE_W - 72, align: "right" });
        ty = 62;
        firstTCPage = false;
      }
    };

    // First T&C page: date top-right, then centered title
    drawDate(doc, dateStr);
    ty = 62;

    // Title block
    doc.font(FONT_BOLD).fontSize(11).fillColor("#000000")
       .text("GENERAL TERMS AND CONDITIONS OF SALE", 36, ty, { width: PAGE_W - 72, align: "center" });
    ty += 16;
    doc.font(FONT_BOLD).fontSize(10)
       .text("(TIME AND MATERIALS)", 36, ty, { width: PAGE_W - 72, align: "center" });
    ty += 16;

    // Opening paragraph
    const introH = doc.heightOfString(TC_INTRO, { width: PAGE_W - 72, align: "left" });
    ensureSpace(introH + 8);
    doc.font(FONT_REG).fontSize(9.5).fillColor("#000000")
       .text(TC_INTRO, 36, ty, { width: PAGE_W - 72 });
    ty += introH + 10;

    // Numbered sections
    for (const sec of TC_SECTIONS) {
      const sectionText = sec.body;
      const headingH = 13;
      const bodyH = doc.font(FONT_REG).fontSize(9.5).heightOfString(sectionText, { width: PAGE_W - 72 });
      const totalH = headingH + bodyH + 12;

      // If the entire section fits, render it; otherwise let it flow across pages
      if (ty + Math.min(totalH, 80) > FOOTER_Y - 10) {
        drawFooter(doc);
        doc.addPage({ margin: 0, size: "LETTER" });
        drawDate(doc, dateStr);
        doc.font(FONT_REG).fontSize(10).fillColor("#000000")
           .text(`QUOTE#: ${quoteNum}`, 36, 36, { width: PAGE_W - 72, align: "right" });
        ty = 62;
        firstTCPage = false;
      }

      // Render heading inline (bold prefix + body)
      // Build full paragraph: "1. HEADING: body text"
      const fullPara = `${sec.heading} ${sec.body}`;
      const paraH = doc.font(FONT_REG).fontSize(9.5).heightOfString(fullPara, { width: PAGE_W - 72 });

      // If paragraph would overflow, check if we need a new page
      if (ty + paraH > FOOTER_Y - 10 && paraH < FOOTER_Y - 80) {
        drawFooter(doc);
        doc.addPage({ margin: 0, size: "LETTER" });
        drawDate(doc, dateStr);
        doc.font(FONT_REG).fontSize(10).fillColor("#000000")
           .text(`QUOTE#: ${quoteNum}`, 36, 36, { width: PAGE_W - 72, align: "right" });
        ty = 62;
        firstTCPage = false;
      }

      // Render the section — heading bold, body regular, inline
      // We do this by rendering the heading bold then the body regular on the same flow
      doc.font(FONT_BOLD).fontSize(9.5).fillColor("#000000")
         .text(sec.heading + " ", 36, ty, { width: PAGE_W - 72, continued: true });
      doc.font(FONT_REG);

      // Handle multi-paragraph body (split by \n\n)
      const paragraphs = sec.body.split("\n\n");
      paragraphs.forEach((para, pi) => {
        if (pi === 0) {
          // First paragraph continues from heading
          doc.text(para, { width: PAGE_W - 72, continued: false });
          ty += doc.heightOfString(sec.heading + " " + para, { width: PAGE_W - 72 }) + 4;
        } else {
          // Subsequent paragraphs in same section
          if (ty + doc.heightOfString(para, { width: PAGE_W - 72 }) > FOOTER_Y - 10) {
            drawFooter(doc);
            doc.addPage({ margin: 0, size: "LETTER" });
            drawDate(doc, dateStr);
            doc.font(FONT_REG).fontSize(10).fillColor("#000000")
               .text(`QUOTE#: ${quoteNum}`, 36, 36, { width: PAGE_W - 72, align: "right" });
            ty = 62;
            firstTCPage = false;
          }
          doc.font(FONT_REG).fontSize(9.5).fillColor("#000000")
             .text(para, 36, ty, { width: PAGE_W - 72 });
          ty += doc.heightOfString(para, { width: PAGE_W - 72 }) + 4;
        }
      });

      ty += 6; // gap between sections
    }

    drawFooter(doc);

    doc.end();
  } catch (err) {
    console.error("Error generating quote PDF:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate PDF" });
    }
  }
});

export default router;
