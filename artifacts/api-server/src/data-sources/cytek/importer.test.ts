/**
 * Verifies the Cytek workbook -> normalized data transformation against the
 * real source workbooks committed in ./source, and that the generated JSON
 * bundled with the server matches a fresh import.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import xlsx from "xlsx";
import { importCytek, readSheetByHeaders, toIsoDate, ASSET_SHEET } from "./importer.js";
import manifestJson from "./manifest.json";
import assetsJson from "./assets.json";
import productsJson from "./products.json";
import type { DataSourceManifest } from "../types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name: string) => xlsx.read(readFileSync(path.join(here, "source", name)), { type: "buffer" });
const rev6 = load("cytek-quoting-tool-rev6.xlsx");
const rev5 = load("cytek-quoting-tool-rev5.xlsx");
const fileInfo = (fileName: string) => ({ fileName, label: fileName, sha256: "test" });

const result = importCytek({
  primary: { workbook: rev6, file: fileInfo("rev6") },
  supplement: { workbook: rev5, file: fileInfo("rev5") },
  now: new Date("2026-09-19T00:00:00Z"),
});
const bySerial = new Map(result.assets.map((a) => [a.serialNumber.toLowerCase(), a]));
const manifest = manifestJson as DataSourceManifest;

test("record counts match the committed manifest", () => {
  assert.equal(result.assets.length, 9635);
  assert.equal(result.products.length, 5178);
  assert.equal(result.manifest.counts.assets, manifest.counts.assets);
  assert.equal(result.manifest.counts.products, manifest.counts.products);
  assert.equal(result.manifest.counts.services, manifest.counts.services);
  assert.equal(result.manifest.counts.assetsEnrichedFromSupplement, 2542);
  assert.equal(result.manifest.counts.assetsFacilityDefaultedToAccount, 7093);
  assert.equal(result.manifest.counts.assetsEnrichedWithDifferentAccountName, manifest.counts.assetsEnrichedWithDifferentAccountName);
});

test("committed assets.json / products.json equal a fresh import (compact form)", () => {
  const strip = (rows: object[]) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== "")));
  assert.deepEqual(assetsJson, strip(result.assets));
  assert.deepEqual(productsJson, strip(result.products));
});

test("rejections are explained", () => {
  const r = result.manifest.rejected;
  assert.equal(r["asset: only in supplement (not in primary), skipped"].count, 1043);
  assert.equal(r["product: no unit price"].count, 242);
  assert.ok(r["product: no unit price"].samples.includes("Basic contract deductible"));
  assert.equal(r["product: blank display name"].count, 15);
  assert.equal(r["asset: duplicate serial number (first occurrence kept)"], undefined);
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
  assert.equal(a.contactName, "");
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
});

test("account name updated by Rev6 where it changed; Rev5 contact/address still carried over", () => {
  const a = bySerial.get("6735125120");
  assert.ok(a);
  assert.equal(a.accountName, "Millipore Sigma (formerly Mirius Bio LLC)");
  const r = bySerial.get("r0732");
  assert.ok(r);
  assert.equal(r.accountName, "Combined Therapeutics Inc", "Rev6 account");
  assert.equal(r.contactName, "Juliana Barrios", "Rev5 contact carried over");
  assert.equal(r.street, "100 Forge Street (2nd Floor)");
  assert.equal(r.contractType, "");
  assert.equal(r.contractEndDate, "");
  assert.ok(result.manifest.counts.assetsEnrichedWithDifferentAccountName > 0);
});

test("asset only in Rev5 is not imported", () => {
  assert.equal(bySerial.get("8470060146"), undefined);
});

test("products: part, service, and cost exclusion", () => {
  const byName = (n: string) => result.products.filter((p) => p.partName === n);
  const flowCell = byName("Flow Cell Body");
  assert.equal(flowCell.length, 1);
  assert.deepEqual(flowCell[0], { partName: "Flow Cell Body", partNumber: "N0-00011", listPrice: 268.71, netPrice: 268.71, category: "Parts", unit: "Each" });
  const onsite = byName("On-Site Support (2 days)");
  assert.equal(onsite.length, 1);
  assert.equal(onsite[0].partNumber, "60020");
  assert.equal(onsite[0].listPrice, 7571);
  assert.equal(onsite[0].category, "Service");
  const contract = byName("Aurora 5 Laser - UV/V/B/YG/R - Premium");
  assert.ok(contract.length >= 1);
  assert.equal(contract[0].category, "Service");
  assert.equal(contract[0].unit, "Year");
  assert.equal(byName("Basic contract deductible").length, 0, "unpriced rows are rejected");
  for (const p of result.products) assert.equal(p.netPrice, p.listPrice, "no cost data may reach the API");
});

test("readSheetByHeaders fails loudly when a required column is missing", () => {
  assert.throws(
    () => readSheetByHeaders(rev6, ASSET_SHEET, ["Serial Number", "Nonexistent Column"], "rev6"),
    /missing expected column\(s\): "Nonexistent Column"/,
  );
  assert.throws(() => readSheetByHeaders(rev6, "No Such Sheet", [], "rev6"), /sheet "No Such Sheet" not found/);
});

test("toIsoDate handles Excel serials, m/d/yy strings and blanks", () => {
  assert.equal(toIsoDate(43369), "2018-09-26");
  assert.equal(toIsoDate("9/26/18"), "2018-09-26");
  assert.equal(toIsoDate("7/2/2030"), "2030-07-02");
  assert.equal(toIsoDate(""), "");
  assert.equal(toIsoDate(null), "");
});
