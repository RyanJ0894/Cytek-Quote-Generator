/**
 * Upload Mode reads the "FSE Input" sheet of a user-supplied workbook. Rev6's
 * FSE Input formulas are #REF!, so the customer block resolves to blanks while
 * typed values (customer name, serial, parts) still come through.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import xlsx from "xlsx";
import { findFseSheetName, parseFSEInput } from "./fseUploadParser.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(here, "..", "data-sources", "cytek", "source");

function parse(fileName: string) {
  const wb = xlsx.read(readFileSync(path.join(SOURCE, fileName)), { type: "buffer" });
  const sheet = findFseSheetName(wb.SheetNames);
  assert.ok(sheet);
  const grid = xlsx.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" }) as unknown[][];
  return parseFSEInput(grid);
}

test("Rev5 FSE Input (intact formulas) parses fully", () => {
  const r = parse("cytek-quoting-tool-rev5.xlsx");
  assert.equal(r.quoteType, "Service and Parts");
  assert.equal(r.serviceQuote.customerName, "Alyssa Sanfillipo");
  assert.equal(r.serviceQuote.serialNumber, "R0732");
  assert.equal(r.serviceQuote.facilityName, "abata THERAPEUTICS");
  assert.equal(r.partsQuote.serialNumber, "U1399");
  assert.equal(r.partsQuote.contractType, "Premium");
  assert.deepEqual(r.serviceQuote.parts, [{ name: "On-Site Support (2 days)", partNumber: "60020", price: 7571, quantity: 1 }]);
  assert.equal(r.partsQuote.parts.length, 4);
  assert.deepEqual(r.partsQuote.parts[1], { name: "Flow Cell Body", partNumber: "N0-00011", price: 268.71, quantity: 1 });
});

test("Rev6 FSE Input (#REF! lookups) still yields typed values; looked-up fields are blank", () => {
  const r = parse("cytek-quoting-tool-rev6.xlsx");
  assert.equal(r.serviceQuote.customerName, "Alyssa Sanfillipo");
  assert.equal(r.serviceQuote.serialNumber, "R0732");
  assert.equal(r.serviceQuote.facilityName, "", "VLOOKUP is #REF! in Rev6");
  assert.equal(r.serviceQuote.address, "");
  assert.equal(r.partsQuote.serialNumber, "U1399");
  assert.equal(r.serviceQuote.parts[0].name, "On-Site Support (2 days)");
  assert.equal(r.serviceQuote.parts[0].price, 7571);
});
