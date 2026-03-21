import { Router, type IRouter, type Request, type Response } from "express";
import PDFDocument from "pdfkit";
import path from "path";
import { existsSync } from "fs";

const router: IRouter = Router();

// ── Logo path resolution (dev vs prod) ──────────────────────────────────
function resolveLogoPath(): string {
  const candidates = [
    path.join(process.cwd(), "src/data/cytek-logo.png"),
    path.join(process.cwd(), "artifacts/api-server/src/data/cytek-logo.png"),
    path.join(process.cwd(), "data/cytek-logo.png"),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

const LOGO_PATH = resolveLogoPath();

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

// ── Page constants ──────────────────────────────────────────────────────
const PAGE_W  = 612;
const PAGE_H  = 792;
const ML      = 36;   // left margin
const MR      = 576;  // right margin

// ── Table column X positions (left edge of each column) ─────────────────
// Total table width: 576 - 36 = 540pt
// Col widths: Item=35 | Desc=155 | PartNum=100 | Qty=30 | List=65 | Net=65 | Ext=90
const TC = {
  item:      36,   // 35pt wide
  desc:      71,   // 155pt wide
  partNum:   226,  // 100pt wide
  qty:       326,  // 30pt wide
  listPrice: 356,  // 65pt wide
  netPrice:  421,  // 65pt wide
  extPrice:  486,  // 90pt wide
  right:     576,
};

const ROW_H   = 20;   // default row height
const HDR_H   = 28;   // header row height (2-line labels)
const FOOTER_Y = PAGE_H - 54;

const FONT_REG  = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";
const FONT_OBL  = "Helvetica-Oblique";

const LOGO_W = 160;
const LOGO_H = Math.round(LOGO_W * (431 / 1505)); // ~46pt

function fmtDate(): string {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Cell border drawing helper ──────────────────────────────────────────
function cellBorder(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  fillColor?: string
): void {
  if (fillColor) {
    doc.rect(x, y, w, h).fillColor(fillColor).fill();
  }
  doc.rect(x, y, w, h).strokeColor("#000000").lineWidth(0.5).stroke();
}

// Draw one full table row: each cell gets a border, text is drawn inside
function tableRow(
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
  bold = false
): void {
  const pad = 3; // inner padding

  cellBorder(doc, TC.item,      y, TC.desc      - TC.item,      rowH);
  cellBorder(doc, TC.desc,      y, TC.partNum   - TC.desc,      rowH);
  cellBorder(doc, TC.partNum,   y, TC.qty       - TC.partNum,   rowH);
  cellBorder(doc, TC.qty,       y, TC.listPrice - TC.qty,       rowH);
  cellBorder(doc, TC.listPrice, y, TC.netPrice  - TC.listPrice, rowH);
  cellBorder(doc, TC.netPrice,  y, TC.extPrice  - TC.netPrice,  rowH);
  cellBorder(doc, TC.extPrice,  y, TC.right     - TC.extPrice,  rowH);

  const font = bold ? FONT_BOLD : FONT_REG;
  const ty = y + rowH / 2 - 5;

  doc.font(font).fontSize(9).fillColor("#000000");
  doc.text(itemNum,   TC.item      + pad, ty, { width: TC.desc      - TC.item      - pad * 2, align: "center" });
  doc.text(desc,      TC.desc      + pad, ty, { width: TC.partNum   - TC.desc      - pad * 2, align: "left" });
  doc.text(partNum,   TC.partNum   + pad, ty, { width: TC.qty       - TC.partNum   - pad * 2, align: "left" });
  doc.text(qty,       TC.qty       + pad, ty, { width: TC.listPrice - TC.qty       - pad * 2, align: "center" });
  doc.text(listPrice, TC.listPrice + pad, ty, { width: TC.netPrice  - TC.listPrice - pad * 2, align: "right" });
  doc.text(netPrice,  TC.netPrice  + pad, ty, { width: TC.extPrice  - TC.netPrice  - pad * 2, align: "right" });
  doc.text(extPrice,  TC.extPrice  + pad, ty, { width: TC.right     - TC.extPrice  - pad * 2, align: "right" });
}

// Draw the table header row (2-line labels, light gray bg)
function tableHeader(doc: PDFKit.PDFDocument, y: number): void {
  const pad = 3;
  const bg  = "#E8E8E8";

  cellBorder(doc, TC.item,      y, TC.desc      - TC.item,      HDR_H, bg);
  cellBorder(doc, TC.desc,      y, TC.partNum   - TC.desc,      HDR_H, bg);
  cellBorder(doc, TC.partNum,   y, TC.qty       - TC.partNum,   HDR_H, bg);
  cellBorder(doc, TC.qty,       y, TC.listPrice - TC.qty,       HDR_H, bg);
  cellBorder(doc, TC.listPrice, y, TC.netPrice  - TC.listPrice, HDR_H, bg);
  cellBorder(doc, TC.netPrice,  y, TC.extPrice  - TC.netPrice,  HDR_H, bg);
  cellBorder(doc, TC.extPrice,  y, TC.right     - TC.extPrice,  HDR_H, bg);

  // Line 1
  doc.font(FONT_BOLD).fontSize(9).fillColor("#000000");
  doc.text("Item",           TC.item      + pad, y + 4,  { width: TC.desc      - TC.item      - pad * 2, align: "center" });
  doc.text("Description",   TC.desc      + pad, y + 4,  { width: TC.partNum   - TC.desc      - pad * 2, align: "left" });
  doc.text("Product",       TC.partNum   + pad, y + 4,  { width: TC.qty       - TC.partNum   - pad * 2, align: "left" });
  doc.text("Qty",           TC.qty       + pad, y + 4,  { width: TC.listPrice - TC.qty       - pad * 2, align: "center" });
  doc.text("List",          TC.listPrice + pad, y + 4,  { width: TC.netPrice  - TC.listPrice - pad * 2, align: "right" });
  doc.text("Net",           TC.netPrice  + pad, y + 4,  { width: TC.extPrice  - TC.netPrice  - pad * 2, align: "right" });
  doc.text("Ext. Price",    TC.extPrice  + pad, y + 4,  { width: TC.right     - TC.extPrice  - pad * 2, align: "right" });

  // Line 2
  doc.text("",              TC.item      + pad, y + 16, { width: TC.desc      - TC.item      - pad * 2, align: "center" });
  doc.text("",              TC.desc      + pad, y + 16, { width: TC.partNum   - TC.desc      - pad * 2 });
  doc.text("Number",        TC.partNum   + pad, y + 16, { width: TC.qty       - TC.partNum   - pad * 2, align: "left" });
  doc.text("",              TC.qty       + pad, y + 16, { width: TC.listPrice - TC.qty       - pad * 2 });
  doc.text("Price",         TC.listPrice + pad, y + 16, { width: TC.netPrice  - TC.listPrice - pad * 2, align: "right" });
  doc.text("Price",         TC.netPrice  + pad, y + 16, { width: TC.extPrice  - TC.netPrice  - pad * 2, align: "right" });
  doc.text("",              TC.extPrice  + pad, y + 16, { width: TC.right     - TC.extPrice  - pad * 2 });
}

// Draw the S&H + Total footer rows (merged label cell, value cell)
function tableTotals(
  doc: PDFKit.PDFDocument,
  y: number,
  shippingLabel: string,
  totalLabel: string,
  totalValue: string
): number {
  const pad = 3;

  // S&H row: merged columns item..netPrice for label, extPrice for value
  const shLabelW = TC.netPrice - TC.item;
  cellBorder(doc, TC.item,    y,         shLabelW,                  ROW_H);
  cellBorder(doc, TC.netPrice, y,         TC.right - TC.netPrice,    ROW_H);
  doc.font(FONT_REG).fontSize(9).fillColor("#000000")
     .text(shippingLabel, TC.item + pad, y + ROW_H / 2 - 5,
       { width: shLabelW - pad * 2, align: "right" });
  // S&H value cell (blank in reference PDFs)
  y += ROW_H;

  // Total row
  const totLabelW = TC.extPrice - TC.item;
  cellBorder(doc, TC.item,    y, totLabelW,               ROW_H);
  cellBorder(doc, TC.extPrice, y, TC.right - TC.extPrice,  ROW_H);
  doc.font(FONT_BOLD).fontSize(9).fillColor("#000000")
     .text(totalLabel, TC.item + pad, y + ROW_H / 2 - 5,
       { width: totLabelW - pad * 2, align: "right" });
  doc.font(FONT_BOLD).fontSize(9)
     .text(totalValue, TC.extPrice + pad, y + ROW_H / 2 - 5,
       { width: TC.right - TC.extPrice - pad * 2, align: "right" });
  y += ROW_H;

  return y;
}

// Identical footer on every page
function drawFooter(doc: PDFKit.PDFDocument): void {
  doc.moveTo(ML, FOOTER_Y).lineTo(MR, FOOTER_Y)
     .strokeColor("#000000").lineWidth(0.5).stroke();
  doc.font(FONT_REG).fontSize(8).fillColor("#000000")
     .text(
       "Cytek Biosciences Inc. | Offices in Fremont, CA 94538. 47215 Lakeview Blvd",
       ML, FOOTER_Y + 5, { width: PAGE_W - ML * 2, align: "center" }
     )
     .text(
       "Phone: (510) 657-0102 | Fax: (510) 657-0151 | www.cytekbio.com | email: technical.support@cytekbio.com",
       ML, FOOTER_Y + 17, { width: PAGE_W - ML * 2, align: "center" }
     );
}

// Logo + date on every page; optionally place QUOTE# box below logo on the right.
// Returns the Y coordinate where content should start.
function drawPageHeader(
  doc: PDFKit.PDFDocument,
  dateStr: string,
  quoteNum?: string
): number {
  if (existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, ML, ML, { width: LOGO_W });
  }
  doc.font(FONT_REG).fontSize(10).fillColor("#000000")
     .text(dateStr, ML, ML, { width: PAGE_W - ML * 2, align: "right" });
  if (quoteNum) {
    const boxY = ML + LOGO_H + 8;
    drawQuoteNumBox(doc, quoteNum, MR - 184, boxY);
    return boxY + 18 + 10;
  }
  return ML + LOGO_H + 14;
}

// QUOTE# in a bordered rectangle (for quote page only)
function drawQuoteNumBox(
  doc: PDFKit.PDFDocument,
  quoteNum: string,
  x: number,
  y: number
): void {
  const text  = `QUOTE#: ${quoteNum}`;
  const boxW  = 180;
  const boxH  = 18;
  doc.rect(x, y, boxW, boxH).strokeColor("#000000").lineWidth(0.8).stroke();
  doc.font(FONT_BOLD).fontSize(9).fillColor("#000000")
     .text(text, x + 4, y + 4, { width: boxW - 8, align: "left" });
}

// ── T&C content ─────────────────────────────────────────────────────────
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
  {
    heading: "10. GOVERNING LAW:",
    body: `This Agreement shall be governed in accordance with the laws of the State of California. The United Nations Convention on Contracts for the International Sale of Goods will not apply to these Terms. You and Cytek consent to the jurisdiction of, and venue in, the state and federal courts in Alameda County, California, U.S.A.`,
  },
  {
    heading: "11. ENTIRE AGREEMENT:",
    body: `These Terms constitute the entire understanding between you and Cytek with respect to the subject matter hereof and supersede all prior or co-existing communications and agreements regarding such subject matter and cannot be modified except by a written document (which states that it is an amendment) signed by authorized signatories of both parties. Any terms or conditions on your purchase order, order acknowledgement, or any other document relating to the products will be without legal effect.`,
  },
  {
    heading: "12. GOVERNMENT CONTRACTS:",
    body: `If the products are to be used in the performance of a U.S. Government contract or subcontract and a U.S. Government contract number appears on your purchase order, those clauses of the applicable U.S. Government procurement regulations that are mandatorily required by law to be included in U.S. Government subcontracts are incorporated into these Terms.`,
  },
  {
    heading: "13. EXPORT AND USE RESTRICTIONS; INDEMNITY BY BUYER:",
    body: `You acknowledge that Cytek products may be subject to the US export laws and regulations. You may not export or re-export the products (nor any direct product therefrom) in violation of the US export laws. You hereby certify that you are not on the US Department of Commerce's Denied Persons List or affiliated lists or on the US Department of Treasury Specially Designated Nationals List. To the extent required, you shall abide by any and all notices regarding export and agree not to remove or allow any third party to remove such notices. Your obligation under this section shall survive the expiration or termination of this agreement. You may not, and may not authorize or permit any affiliate or third party to, gain access to or determine the methods of operation of the product, alter, modify, disassemble, dismantle, deconstruct, analyze, determine compositions or structures, design around, or reverse engineer the product, or any part of the product, nor attempt to, or allow others to, products, reconstruct, create, develop a contract to develop a product similar to the product. You shall use the products in strict accordance with all applicable local, state, national, and supra-national laws, regulations and guidelines, as well as all safety precautions accompanying the products. You shall indemnify and hold harmless Cytek from any and all claims, damages, losses, fines or expenses arising out of or resulting from your breach of these Terms or any act or omission by you, or its agents, employees or subcontractors, in the handling, storage or use of the products, except to the extent caused by a breach of the warranty by Cytek as set forth above.`,
  },
  {
    heading: "14. MISCELLANEOUS:",
    body: `No waiver of rights under these Terms by either party shall constitute a subsequent waiver of this or any other right or remedy under these Terms nor are any rights hereunder shall be assigned or otherwise transferred by Buyer (by operation of law or otherwise) without the prior written consent of Cytek and any unauthorized transfer or assignment shall be void. If any of the terms and conditions set forth herein are held to be illegal or unenforceable, all remaining terms set forth herein shall remain in full force and effect. Cytek will not be liable for any delay in performance or failure to perform under these Terms due to circumstances beyond its reasonable control, including epidemics, pandemics, quarantines, earthquakes and other acts of God, actions of government, strikes, fire, explosion, flood, riot, lock-out, injunction, interruption of transportation, supplies or utilities, unavoidable accidents, or inability to obtain supplies at reasonable prices.`,
  },
];

// ── Route handler ────────────────────────────────────────────────────────
router.post("/generate", (req: Request, res: Response) => {
  try {
    const data = req.body as QuoteRequest;
    const dateStr  = fmtDate();
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
    let y = drawPageHeader(doc, dateStr);

    // ── Customer block (left) ────────────────────────────────────
    const customerTopY = y; // save for QUOTE# box alignment

    doc.font(FONT_BOLD).fontSize(10).fillColor("#000000")
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
    drawQuoteNumBox(doc, quoteNum, MR - 184, customerTopY);

    y += 12; // gap before table

    // ── Items table ──────────────────────────────────────────────
    tableHeader(doc, y);
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
      tableRow(doc, y, ROW_H, "", "No items.", "", "", "", "", "");
      y += ROW_H;
    } else {
      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];

        // Check if we need a new page
        if (y + ROW_H > FOOTER_Y - 60) {
          drawFooter(doc);
          doc.addPage({ margin: 0, size: "LETTER" });
          y = drawPageHeader(doc, dateStr, quoteNum);
          tableHeader(doc, y);
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
          fmtMoney(ext)
        );
        y += ROW_H;
      }
    }

    // ── S&H and Total rows ───────────────────────────────────────
    const shipping = data.shipping || 0;
    const total = extTotal + shipping;

    y = tableTotals(doc, y, "Shipping & Handling Estimate", "Total", fmtMoney(total));

    // ── Notes (user-entered, below table) ────────────────────────
    if (data.notes && data.notes.trim()) {
      y += 10;
      doc.font(FONT_REG).fontSize(9).fillColor("#000000")
         .text(`      ${data.notes.trim()}`, ML, y, { width: MR - ML });
      y += doc.heightOfString(data.notes.trim(), { width: MR - ML }) + 10;
    }

    y += 16;

    // ── Standard bullet points ────────────────────────────────────
    const bullets = [
      "-All prices in USD",
      "-The above quotation does not include any applicable sales tax.",
      "-Cytek will confirm order receipt and estimated ship date.",
      "-This quote is valid for 60 days.",
    ];
    doc.font(FONT_REG).fontSize(9).fillColor("#000000");
    for (const b of bullets) {
      doc.text(b, ML, y, { width: MR - ML });
      y += 13;
    }

    drawFooter(doc);

    // ═══════════════════════════════════════════════════════════════
    // PAGE 2+ — GENERAL TERMS AND CONDITIONS OF SALE
    // ═══════════════════════════════════════════════════════════════
    doc.addPage({ margin: 0, size: "LETTER" });

    // First T&C page: logo + date + QUOTE# box
    let ty = drawPageHeader(doc, dateStr, quoteNum);
    let isFirstTCPage = true;

    // T&C title (centered)
    doc.font(FONT_BOLD).fontSize(11).fillColor("#000000")
       .text("GENERAL TERMS AND CONDITIONS OF SALE", ML, ty, { width: PAGE_W - ML * 2, align: "center" });
    ty += 16;
    doc.font(FONT_BOLD).fontSize(10)
       .text("(TIME AND MATERIALS)", ML, ty, { width: PAGE_W - ML * 2, align: "center" });
    ty += 16;

    // Helper: start a new T&C continuation page
    const newTCPage = () => {
      drawFooter(doc);
      doc.addPage({ margin: 0, size: "LETTER" });
      // Logo + date + QUOTE# box on every T&C continuation page
      ty = drawPageHeader(doc, dateStr, quoteNum);
      isFirstTCPage = false;
    };

    // Helper: ensure space or break page
    const ensureSpace = (needed: number) => {
      if (ty + needed > FOOTER_Y - 10) {
        newTCPage();
      }
    };

    // Opening paragraph
    const introH = doc.font(FONT_REG).fontSize(9.5).heightOfString(TC_INTRO, { width: PAGE_W - ML * 2 });
    ensureSpace(introH + 8);
    doc.font(FONT_REG).fontSize(9.5).fillColor("#000000")
       .text(TC_INTRO, ML, ty, { width: PAGE_W - ML * 2 });
    ty += introH + 10;

    // Numbered sections
    for (const sec of TC_SECTIONS) {
      const paragraphs = sec.body.split("\n\n");

      // Measure the first paragraph (heading + first body para) together
      const firstParaText = `${sec.heading} ${paragraphs[0]}`;
      const firstParaH = doc.font(FONT_REG).fontSize(9.5).heightOfString(firstParaText, { width: PAGE_W - ML * 2 });

      ensureSpace(Math.min(firstParaH, 60));

      // Render heading (bold) continued into first paragraph (regular)
      doc.font(FONT_BOLD).fontSize(9.5).fillColor("#000000")
         .text(`${sec.heading} `, ML, ty, { width: PAGE_W - ML * 2, continued: true });
      doc.font(FONT_REG)
         .text(paragraphs[0], { continued: false });
      ty += firstParaH + 4;

      // Render remaining paragraphs in the same section
      for (let pi = 1; pi < paragraphs.length; pi++) {
        const paraH = doc.font(FONT_REG).fontSize(9.5).heightOfString(paragraphs[pi], { width: PAGE_W - ML * 2 });
        ensureSpace(paraH + 4);
        doc.font(FONT_REG).fontSize(9.5).fillColor("#000000")
           .text(paragraphs[pi], ML, ty, { width: PAGE_W - ML * 2 });
        ty += paraH + 4;
      }

      ty += 6; // inter-section gap
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
