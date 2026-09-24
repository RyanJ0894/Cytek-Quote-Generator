/**
 * Verifies the workbook -> normalized data transformation against the real
 * Cytek workbooks committed in ./cytek/source, and that the generated JSON
 * bundled with the server matches a fresh import.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import xlsx from "xlsx";
import { importWorkbook, readSheet, toIsoDate, ASSET_SHEET } from "./workbook-importer.js";
import manifestJson from "./cytek/manifest.json";
import assetsJson from "./cytek/assets.json";
import productsJson from "./cytek/products.json";
import type { DataSourceManifest } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name: string) => xlsx.read(readFileSync(path.join(here, "cytek", "source", name)), { type: "buffer" });
export const rev6 = load("cytek-quoting-tool-rev6.xlsx");
export const rev5 = load("cytek-quoting-tool-rev5.xlsx");
const fileInfo = (fileName: string) => ({ fileName, label: fileName, sha256: "test" });

const result = importWorkbook({
  id: "cytek",
  name: "Cytek",
  primary: { workbook: rev6, file: fileInfo("rev6") },
  supplement: { workbook: rev5, file: fileInfo("rev5") },
  now: new Date("2026-09-24T00:00:00Z"),
});
const bySerial = new Map(result.assets.map((a) => [a.serialNumber.toLowerCase(), a]));
const byName = (n: string) => result.products.filter((p) => p.partName === n);
const manifest = manifestJson as DataSourceManifest;

test("record counts match the committed manifest", () => {
  assert.equal(result.assets.length, 9635);
  assert.equal(result.products.length, 5419);
  assert.deepEqual(result.manifest.counts, manifest.counts);
  assert.equal(result.manifest.counts.pricedProducts, 5180);
  assert.equal(result.manifest.counts.unpricedProducts, 239);
  assert.equal(result.manifest.counts.services, 164);
  assert.equal(result.manifest.counts.assetsEnrichedFromSupplement, 2542);
  assert.equal(result.manifest.counts.assetsEnrichedWithDifferentAccountName, 263);
  assert.equal(result.manifest.counts.assetsFacilityDefaultedToAccount, 7093);
});

test("committed assets.json / products.json equal a fresh import (compact form)", () => {
  const strip = (rows: object[]) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== "")));
  assert.deepEqual(assetsJson, strip(result.assets));
  assert.deepEqual(productsJson, strip(result.products));
});

test("rejections are explained and nothing priced is silently dropped", () => {
  const r = result.manifest.rejected;
  assert.equal(r["asset: only in supplement (not in primary), skipped"].count, 1043);
  assert.equal(r["product: negative price (discount/adjustment item, not quotable)"].count, 10);
  assert.equal(r["product: pricing adjustment item (discount/surcharge), not quotable"].count, 5);
  assert.equal(r["product: no unit price"], undefined, "unpriced rows are imported (flagged), not rejected");
  assert.equal(Object.keys(r).length, 3);
});

test("Rev6-only asset (not in the old bundled data) is imported with Rev6 fields", () => {
  const a = bySerial.get("ne0006");
  assert.ok(a, "NE0006 should exist");
  assert.equal(a.productName, "Cytek Northern Lights- CLC IVD 2000 B&V");
  assert.equal(a.accountName, "Medical Company Empirica");
  assert.equal(a.facilityName, "Medical Company Empirica", "no facility code in Rev6 -> defaults to account");
  assert.equal(a.contractType, "Warranty");
  assert.equal(a.contractNumber, "00013907");
  assert.equal(a.contractEndDate, "2022-07-01");
  assert.equal(a.installDate, "2021-06-25");
  assert.equal(a.country, "Ukraine");
  assert.equal(a.assetStatus, "Installed");
  assert.equal(a.street, "");
});

test("asset present in both workbooks takes Rev6 truth plus Rev5 address/contact enrichment", () => {
  const a = bySerial.get("u1399");
  assert.ok(a);
  assert.equal(a.accountName, "Ragon Institute of MGH MIT and Harvard");
  assert.equal(a.productName, "Cytek Aurora? 5L UV/V/B/YG/R", "product name comes from Rev6");
  assert.equal(a.contractType, "Premium");
  assert.equal(a.contractEndDate, "2026-06-24");
  assert.equal(a.facilityName, "RGON", "facility code carried over from Rev5");
  assert.equal(a.street, "Ragon Institute of MGH MIT and Harvard - 600 Main St");
  assert.equal(a.city, "Cambridge");
  assert.equal(a.stateZip, "Massachusetts 02139");
  assert.equal(a.region, "North America");
  assert.equal(a.country, "United States");
  const r = bySerial.get("r0732")!;
  assert.equal(r.accountName, "Combined Therapeutics Inc", "Rev6 account wins");
  assert.equal(r.contactName, "Juliana Barrios", "Rev5 contact carried over");
});

test("asset only in Rev5 is not imported", () => {
  assert.equal(bySerial.get("8470060146"), undefined);
});

test("a Rev5-layout workbook imports on its own (address columns come from the primary)", () => {
  const solo = importWorkbook({ id: "rev5", name: "Rev5", primary: { workbook: rev5, file: fileInfo("rev5") } });
  assert.equal(solo.assets.length, 3585);
  const a = solo.assets.find((x) => x.serialNumber === "U1399")!;
  assert.equal(a.facilityName, "RGON");
  assert.equal(a.street, "Ragon Institute of MGH MIT and Harvard - 600 Main St");
  assert.equal(a.contractType, "Premium");
  assert.equal(solo.manifest.fieldMappings.assets.street, "primary Asset Data!Street");
  assert.equal(solo.manifest.counts.assetsEnrichedFromSupplement, 0);
});

test("priced parts and services map exactly", () => {
  assert.deepEqual(byName("Flow Cell Body"), [
    { partName: "Flow Cell Body", partNumber: "N0-00011", listPrice: 268.71, netPrice: 268.71, category: "Parts", unit: "Each", priced: true },
  ]);
  const onsite = byName("On-Site Support (2 days)");
  assert.equal(onsite.length, 1);
  assert.equal(onsite[0].partNumber, "60020");
  assert.equal(onsite[0].listPrice, 7571);
  assert.equal(onsite[0].category, "Service");
  const contract = byName("Aurora 5 Laser - UV/V/B/YG/R - Premium");
  assert.deepEqual(contract.map((p) => [p.partNumber, p.listPrice, p.category, p.unit]), [
    ["N9-90007", 41460, "Service", "Year"],
    ["N9-90007-INA", 29326.5, "Service", "Year"],
  ]);
  assert.equal(byName("Switch Power 12 Support")[0].listPrice, 14.96, "3-decimal source prices are rounded to cents");
  for (const p of result.products) assert.equal(p.netPrice, p.listPrice, "no cost data may reach the API");
});

test("unpriced source rows are kept and flagged; adjustment rows are rejected", () => {
  const deductible = byName("Basic contract deductible");
  assert.equal(deductible.length, 1);
  assert.equal(deductible[0].priced, false);
  assert.equal(deductible[0].listPrice, 0);
  const flatTop = byName("Flat Top Viewing Tool")[0];
  assert.equal(flatTop.priced, false, "zero price in source");
  assert.equal(flatTop.partNumber, "N3-10000-0A");
  assert.equal(flatTop.category, "Parts");
  // name missing in the source but a real, priced part-number row
  const travel = result.products.filter((p) => p.partName === "Travel" && p.partNumber === "Travel");
  assert.equal(travel.length, 1);
  assert.deepEqual([travel[0].listPrice, travel[0].unit, travel[0].category, travel[0].priced], [350, "Hour", "Service", true]);
  assert.equal(byName("Pre-amp Board Test Station")[0].listPrice, 642.9);
  assert.equal(byName("Website Discount (10%)").length, 0, "positive-priced discount label is not quotable");
  assert.equal(byName("Shipping Allowance Discount (25%)").length, 0, "negative-priced rows are not quotable");
  assert.equal(result.products.filter((p) => p.listPrice < 0).length, 0);
});

test("readSheet fails loudly when a required column is missing", () => {
  assert.throws(
    () => readSheet(rev6, ASSET_SHEET, { serial: ["Serial Number"], nope: ["Nonexistent Column"] }, ["serial", "nope"], "rev6"),
    /missing expected column\(s\): "Nonexistent Column"/,
  );
  assert.throws(() => readSheet(rev6, "No Such Sheet", {}, [], "rev6"), /sheet "No Such Sheet" not found/);
  const blank = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(blank, xlsx.utils.aoa_to_sheet([["Foo"]]), "Asset Data");
  assert.throws(
    () => importWorkbook({ id: "x", name: "x", primary: { workbook: blank, file: fileInfo("blank") } }),
    /"Serial Number" or "Asset Name"/,
  );
});

test("toIsoDate handles Excel serials, m/d/yy strings and blanks", () => {
  assert.equal(toIsoDate(43369), "2018-09-26");
  assert.equal(toIsoDate("9/26/18"), "2018-09-26");
  assert.equal(toIsoDate("7/2/2030"), "2030-07-02");
  assert.equal(toIsoDate(""), "");
  assert.equal(toIsoDate(null), "");
});
