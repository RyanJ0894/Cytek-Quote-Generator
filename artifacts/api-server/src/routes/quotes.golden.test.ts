/**
 * Golden-text regression tests for PDF quote generation.
 *
 * Each case POSTs a fixed payload to /api/quotes/generate, extracts the PDF's
 * text, masks the two values that legitimately change per run (today's date
 * and the timestamp-based quote number) and compares the result to a fixture
 * captured from the known-good implementation.
 *
 * Regenerate fixtures deliberately, only when a layout/content change is
 * intended:  UPDATE_GOLDEN=1 pnpm --filter @workspace/api-server test
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Import the inner module: pdf-parse/index.js runs a self-test on load under ESM.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import app from "../app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "__fixtures__");
const UPDATE = process.env["UPDATE_GOLDEN"] === "1";

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

function normalize(text: string): string {
  return text
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, "<DATE>")
    .replace(/Q-\d{8}/g, "<QUOTE#>")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

async function generateText(payload: unknown): Promise<{ text: string; pages: number }> {
  const res = await fetch(`${baseUrl}/api/quotes/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
  const parsed = await pdfParse(buf);
  return { text: normalize(parsed.text), pages: parsed.numpages };
}

async function checkGolden(name: string, payload: unknown) {
  const { text, pages } = await generateText(payload);
  const file = path.join(FIXTURES, `quote-${name}.txt`);
  const body = `pages: ${pages}\n${text}\n`;
  if (UPDATE || !existsSync(file)) {
    writeFileSync(file, body);
    return;
  }
  assert.equal(body, readFileSync(file, "utf8"), `PDF text for "${name}" differs from fixture ${file}`);
}

const customer = {
  customerName: "Alyssa Sanfillipo",
  accountName: "Ragon Institute of MGH MIT and Harvard",
  facilityName: "RGON",
  address: "Ragon Institute of MGH MIT and Harvard - 600 Main St, Cambridge, Massachusetts 02139",
  serialNumber: "U1399",
  contractType: "Premium",
};

test("service + parts quote with shipping and notes", async () => {
  await checkGolden("service-and-parts", {
    ...customer,
    serviceType: "On-Site Support (2 days)",
    servicePrice: 7571,
    parts: [
      { description: "Flow Cell Body", partNumber: "N0-00011", quantity: 2, unitPrice: 268.71 },
      { description: "Mounting Plate", partNumber: "N0-00002", quantity: 3, unitPrice: 7.76 },
    ],
    shipping: 45.5,
    notes: "Please schedule the visit for the week of the 14th.",
  });
});

test("parts-only quote", async () => {
  await checkGolden("parts-only", {
    ...customer,
    parts: [{ description: "Flow Cell Body", partNumber: "N0-00011", quantity: 1, unitPrice: 268.71 }],
    shipping: 0,
  });
});

test("service-only quote", async () => {
  await checkGolden("service-only", {
    ...customer,
    serviceType: "On-Site Support (2 days)",
    servicePrice: 7571,
    parts: [],
  });
});

test("net price column prints when a line's net price differs from list", async () => {
  await checkGolden("net-price", {
    ...customer,
    parts: [{ description: "Flow Cell Body", partNumber: "N0-00011", quantity: 2, unitPrice: 268.71, netPrice: 214.97 }],
  });
});

test("long parts list paginates", async () => {
  const parts = Array.from({ length: 40 }, (_, i) => ({
    description: `Part ${i + 1}`,
    partNumber: `PN-${String(i + 1).padStart(3, "0")}`,
    quantity: (i % 3) + 1,
    unitPrice: 10 + i,
  }));
  await checkGolden("paginated", { ...customer, parts, shipping: 12 });
});

test("empty quote still renders the 'No items.' row", async () => {
  await checkGolden("empty", { customerName: "Nobody", serialNumber: "X", parts: [] });
});
