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

router.post("/generate", (req: Request, res: Response) => {
  try {
    const data = req.body as QuoteRequest;

    const doc = new PDFDocument({ margin: 50, size: "LETTER" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="quote-${data.serialNumber}-${Date.now()}.pdf"`
    );

    doc.pipe(res);

    // ── Header ──────────────────────────────────────────────────────────────
    const primaryBlue = "#003087";
    const lightGray = "#f5f5f5";
    const borderGray = "#cccccc";
    const textGray = "#555555";

    // Top banner
    doc
      .rect(50, 50, doc.page.width - 100, 60)
      .fillColor(primaryBlue)
      .fill();

    doc
      .fillColor("#ffffff")
      .fontSize(22)
      .font("Helvetica-Bold")
      .text("CYTEK BIOSCIENCES", 65, 65)
      .fontSize(11)
      .font("Helvetica")
      .text("Service Quote", 65, 92);

    const dateStr = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    doc
      .fillColor("#ffffff")
      .fontSize(10)
      .text(`Date: ${dateStr}`, doc.page.width - 200, 68, { width: 150, align: "right" })
      .text(`Quote #: Q-${Date.now().toString().slice(-8)}`, doc.page.width - 200, 85, { width: 150, align: "right" });

    doc.moveDown(3);

    // ── Customer Information ─────────────────────────────────────────────────
    const sectionY = 130;
    doc
      .fillColor(primaryBlue)
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("CUSTOMER INFORMATION", 50, sectionY);

    doc
      .moveTo(50, sectionY + 16)
      .lineTo(doc.page.width - 50, sectionY + 16)
      .strokeColor(primaryBlue)
      .lineWidth(1)
      .stroke();

    const leftCol = 50;
    const rightCol = 300;
    let y = sectionY + 26;

    const infoRow = (label: string, value: string, col: number, rowY: number) => {
      doc
        .fillColor(textGray)
        .fontSize(9)
        .font("Helvetica-Bold")
        .text(label, col, rowY)
        .font("Helvetica")
        .text(value || "—", col + 100, rowY);
    };

    infoRow("Customer Name:", data.customerName || "—", leftCol, y);
    infoRow("Serial Number:", data.serialNumber || "—", rightCol, y);
    y += 18;
    infoRow("Account Name:", data.accountName || "—", leftCol, y);
    infoRow("Contract Type:", data.contractType || "—", rightCol, y);
    y += 18;
    infoRow("Facility:", data.facilityName || "—", leftCol, y);
    infoRow("Contract Status:", data.contractStatus || "—", rightCol, y);
    y += 18;
    infoRow("Address:", data.address || "—", leftCol, y);
    infoRow("Product:", data.productName || "—", rightCol, y);
    y += 30;

    // ── Line Items Table ─────────────────────────────────────────────────────
    doc
      .fillColor(primaryBlue)
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("SERVICE & PARTS SUMMARY", 50, y);

    doc
      .moveTo(50, y + 16)
      .lineTo(doc.page.width - 50, y + 16)
      .strokeColor(primaryBlue)
      .lineWidth(1)
      .stroke();

    y += 24;

    // Table header
    doc
      .rect(50, y, doc.page.width - 100, 20)
      .fillColor(primaryBlue)
      .fill();

    doc
      .fillColor("#ffffff")
      .fontSize(9)
      .font("Helvetica-Bold")
      .text("Description", 58, y + 6)
      .text("Part Number", 280, y + 6)
      .text("Qty", 390, y + 6)
      .text("Unit Price", 420, y + 6)
      .text("Ext. Price", 490, y + 6);

    y += 20;

    const allItems: Array<{ description: string; partNumber?: string; quantity: number; unitPrice: number }> = [];

    if (data.serviceType && data.servicePrice && data.servicePrice > 0) {
      allItems.push({
        description: data.serviceType,
        partNumber: "",
        quantity: 1,
        unitPrice: data.servicePrice,
      });
    }

    for (const part of data.parts || []) {
      if (part.description) {
        allItems.push(part);
      }
    }

    let subtotal = 0;
    let rowBg = false;

    for (const item of allItems) {
      const extPrice = (item.quantity || 1) * (item.unitPrice || 0);
      subtotal += extPrice;

      if (rowBg) {
        doc
          .rect(50, y, doc.page.width - 100, 18)
          .fillColor(lightGray)
          .fill();
      } else {
        doc
          .rect(50, y, doc.page.width - 100, 18)
          .fillColor("#ffffff")
          .fill();
      }

      doc
        .rect(50, y, doc.page.width - 100, 18)
        .strokeColor(borderGray)
        .lineWidth(0.5)
        .stroke();

      doc
        .fillColor("#222222")
        .fontSize(9)
        .font("Helvetica")
        .text(item.description || "", 58, y + 5, { width: 215 })
        .text(item.partNumber || "", 280, y + 5, { width: 100 })
        .text(String(item.quantity || 1), 390, y + 5, { width: 25 })
        .text(`$${(item.unitPrice || 0).toFixed(2)}`, 420, y + 5, { width: 65 })
        .text(`$${extPrice.toFixed(2)}`, 490, y + 5, { width: 65 });

      y += 18;
      rowBg = !rowBg;

      if (y > doc.page.height - 180) {
        doc.addPage();
        y = 50;
      }
    }

    if (allItems.length === 0) {
      doc
        .rect(50, y, doc.page.width - 100, 18)
        .fillColor(lightGray)
        .fill();
      doc
        .fillColor(textGray)
        .fontSize(9)
        .font("Helvetica")
        .text("No items added", 58, y + 5);
      y += 18;
    }

    y += 10;

    // ── Totals ───────────────────────────────────────────────────────────────
    const shipping = data.shipping || 0;
    const total = subtotal + shipping;

    const totalsX = 380;
    const totalsLabelW = 100;
    const totalsValW = 80;

    const totalsRow = (label: string, value: string, bold = false) => {
      if (bold) {
        doc
          .rect(totalsX, y, totalsLabelW + totalsValW + 10, 20)
          .fillColor(primaryBlue)
          .fill();
        doc
          .fillColor("#ffffff")
          .fontSize(10)
          .font("Helvetica-Bold")
          .text(label, totalsX + 5, y + 5, { width: totalsLabelW })
          .text(value, totalsX + totalsLabelW + 5, y + 5, { width: totalsValW, align: "right" });
      } else {
        doc
          .fillColor("#222222")
          .fontSize(9)
          .font("Helvetica")
          .text(label, totalsX + 5, y + 3, { width: totalsLabelW })
          .text(value, totalsX + totalsLabelW + 5, y + 3, { width: totalsValW, align: "right" });
      }
      y += bold ? 22 : 16;
    };

    totalsRow("Subtotal:", `$${subtotal.toFixed(2)}`);
    totalsRow("Shipping & Handling:", `$${shipping.toFixed(2)}`);
    totalsRow("TOTAL:", `$${total.toFixed(2)}`, true);

    // ── Notes ────────────────────────────────────────────────────────────────
    if (data.notes && data.notes.trim()) {
      y += 20;
      doc
        .fillColor(primaryBlue)
        .fontSize(11)
        .font("Helvetica-Bold")
        .text("NOTES", 50, y);

      doc
        .moveTo(50, y + 16)
        .lineTo(doc.page.width - 50, y + 16)
        .strokeColor(primaryBlue)
        .lineWidth(1)
        .stroke();

      y += 24;
      doc
        .fillColor("#222222")
        .fontSize(9)
        .font("Helvetica")
        .text(data.notes, 50, y, { width: doc.page.width - 100 });
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 60;
    doc
      .moveTo(50, footerY)
      .lineTo(doc.page.width - 50, footerY)
      .strokeColor(borderGray)
      .lineWidth(0.5)
      .stroke();

    doc
      .fillColor(textGray)
      .fontSize(8)
      .font("Helvetica")
      .text(
        "This quote is valid for 30 days from the date issued. Prices are subject to change. Contact your Cytek service representative for questions.",
        50,
        footerY + 8,
        { width: doc.page.width - 100, align: "center" }
      );

    doc.end();
  } catch (err) {
    console.error("Error generating quote PDF:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate PDF" });
    }
  }
});

export default router;
