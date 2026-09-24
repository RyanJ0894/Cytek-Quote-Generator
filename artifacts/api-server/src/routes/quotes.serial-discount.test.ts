/**
 * Regression coverage for two Brandon-reported issues:
 *  1. the selected serial number (and instrument) must appear in the body of
 *     the generated quote, not only in the file name;
 *  2. per-line discounts must flow into net price, extended price and total.
 * Both are checked end to end: lookup -> payload (as the form builds it) ->
 * PDF -> extracted text.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import app from "../app.js";
import { applyDiscount, lineNetPrice } from "./quotes.js";

let server: http.Server;
let baseUrl = "";
before(async () => {
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function pdfText(payload: unknown): Promise<string> {
  const res = await fetch(`${baseUrl}/api/quotes/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  const parsed = await pdfParse(buf);
  return parsed.text.replace(/\s+/g, " ");
}

test("applyDiscount / lineNetPrice", () => {
  assert.equal(applyDiscount(10000, 10), 9000);
  assert.equal(applyDiscount(10000, 0), 10000);
  assert.equal(applyDiscount(10000, undefined), 10000);
  assert.equal(applyDiscount(268.71, 12.5), 235.12);
  assert.equal(applyDiscount(100, 150), 0, "clamped to 100%");
  assert.equal(applyDiscount(100, -5), 100, "negative discounts ignored");
  assert.equal(lineNetPrice({ unitPrice: 10000, discountPercent: 10 }), 9000);
  assert.equal(lineNetPrice({ unitPrice: 10000, discountPercent: 10, netPrice: 8500 }), 8500, "explicit net wins");
  assert.equal(lineNetPrice({ unitPrice: 10000 }), 10000);
});

test("serial number selected in Manual Mode appears in the quote body and the PDF", async () => {
  // 1. serial can be found
  const lookup = await fetch(`${baseUrl}/api/assets/lookup?serial=U1399`);
  assert.equal(lookup.status, 200);
  const { asset } = (await lookup.json()) as any;
  // 2. the associated asset/customer information populates
  assert.equal(asset.accountName, "Ragon Institute of MGH MIT and Harvard");
  assert.equal(asset.facilityName, "RGON");
  assert.equal(asset.productName, "Cytek Aurora? 5L UV/V/B/YG/R");

  // payload exactly as QuoteForm.onSubmit builds it from the populated form
  const payload = {
    customerName: "Mike Waring",
    accountName: asset.accountName,
    facilityName: asset.facilityName,
    address: [asset.street, asset.city, asset.stateZip].filter(Boolean).join(", "),
    serialNumber: asset.serialNumber,
    contractType: asset.contractType,
    productName: asset.productName,
    serviceType: "On-Site Support (2 days)",
    servicePrice: 7571,
    serviceDiscountPercent: 0,
    parts: [{ description: "Flow Cell Body", partNumber: "N0-00011", quantity: 1, unitPrice: 268.71, discountPercent: 0, netPrice: 268.71 }],
    shipping: 0,
  };
  // 3 + 4. the serial (and instrument) are in the generated quote and survive into the final PDF text
  const text = await pdfText(payload);
  assert.match(text, /Serial Number: U1399/);
  assert.match(text, /Instrument: Cytek Aurora\? 5L UV\/V\/B\/YG\/R/);
  assert.match(text, /Mike Waring RGON Ragon Institute/);
  assert.match(text, /QUOTE#: Q-\d{8}/);
});

test("quote without a product name still prints the serial; without a serial prints neither", async () => {
  const withSerial = await pdfText({ customerName: "A", serialNumber: "ABC-1", parts: [] });
  assert.match(withSerial, /Serial Number: ABC-1/);
  assert.doesNotMatch(withSerial, /Instrument:/);
  const noSerial = await pdfText({ customerName: "A", serialNumber: "", parts: [] });
  assert.doesNotMatch(noSerial, /Serial Number:/);
});

test("line-item discounts: net price, extended price and total use the discounted price", async () => {
  const text = await pdfText({
    customerName: "Brad Ballard",
    serialNumber: "U0286",
    parts: [
      // Brandon's example: $10,000 list, 10% off, qty 2 -> $9,000 each, $18,000 line
      { description: "Big Part", partNumber: "BIG-1", quantity: 2, unitPrice: 10000, discountPercent: 10, netPrice: 9000 },
      // zero/blank discount keeps the list price
      { description: "Flow Cell Body", partNumber: "N0-00011", quantity: 3, unitPrice: 268.71 },
    ],
    shipping: 25,
  });
  assert.match(text, /1 ?Big Part ?BIG-1 ?2 ?\$10,000\.00 ?\$9,000\.00 ?\$18,000\.00/, "list, net and extended columns");
  assert.match(text, /2 ?Flow Cell Body ?N0-00011 ?3 ?\$268\.71 ?\$806\.13/, "no discount: net column blank, ext = 3 x list");
  assert.match(text, /Total ?\$18,831\.13/, "18000 + 806.13 + 25 shipping");
});

test("service line discount", async () => {
  const text = await pdfText({
    customerName: "X",
    serialNumber: "S",
    serviceType: "On-Site Support (2 days)",
    servicePrice: 7571,
    serviceDiscountPercent: 20,
    parts: [],
  });
  assert.match(text, /1 ?On-Site Support \(2 days\) ?1 ?\$7,571\.00 ?\$6,056\.80 ?\$6,056\.80/);
  assert.match(text, /Total ?\$6,056\.80/);
});
