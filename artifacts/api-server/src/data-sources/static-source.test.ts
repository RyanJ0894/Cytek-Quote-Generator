import { test } from "node:test";
import assert from "node:assert/strict";
import { createStaticDataSource, deriveContractStatus } from "./static-source.js";
import { cytekDataSource } from "./cytek/index.js";
import { getDefaultDataSource, summarize } from "./registry.js";
import type { DataSourceManifest } from "./types.js";

const manifest: DataSourceManifest = {
  id: "t", name: "T", importedAt: "2026-01-01T00:00:00.000Z", sources: [],
  counts: { assets: 2, products: 2, services: 1, assetsEnrichedFromSupplement: 0, assetsEnrichedWithDifferentAccountName: 0, assetsFacilityDefaultedToAccount: 0 },
  rejected: {}, fieldMappings: { assets: {}, products: {} }, notes: [],
};

const ds = createStaticDataSource({
  manifest,
  assets: [
    { serialNumber: "AB123", accountName: "Acme", contractEndDate: "2099-01-01" },
    { serialNumber: "zz9", accountName: "Zed" },
    { serialNumber: "AB123", accountName: "Duplicate ignored" },
  ],
  products: [
    { partName: "Widget", partNumber: "W-1", listPrice: 5, netPrice: 5, category: "Parts" },
    { partName: "Visit", partNumber: "S-1", listPrice: 100, netPrice: 100, category: "Service", unit: "Hour" },
  ],
});

test("lookup is exact, case-insensitive and trims whitespace", () => {
  assert.equal(ds.lookupAsset("ab123")?.accountName, "Acme");
  assert.equal(ds.lookupAsset("  AB123 ")?.accountName, "Acme");
  assert.equal(ds.lookupAsset("AB12"), null);
  assert.equal(ds.lookupAsset(""), null);
});

test("omitted fields are hydrated to empty strings / defaults", () => {
  const a = ds.lookupAsset("zz9")!;
  assert.equal(a.street, "");
  assert.equal(a.facilityName, "");
  assert.equal(a.contractEndDate, "");
  const w = ds.listProducts().find((p) => p.partName === "Widget")!;
  assert.equal(w.unit, "");
});

test("contract status derives from the end date", () => {
  assert.equal(ds.lookupAsset("AB123")?.contractStatus, "Activated");
  assert.equal(ds.lookupAsset("zz9")?.contractStatus, "");
  const now = new Date("2026-09-19T12:00:00Z");
  assert.equal(deriveContractStatus("2026-09-19", now), "Activated");
  assert.equal(deriveContractStatus("2026-09-18", now), "Expired");
  assert.equal(deriveContractStatus("not a date", now), "");
});

test("serials are sorted and de-duplicated; services filtered by category", () => {
  assert.deepEqual(ds.listSerials(), ["AB123", "zz9"]);
  assert.deepEqual(ds.listServices().map((p) => p.partName), ["Visit"]);
});

test("Cytek is the registered default data source", () => {
  const d = getDefaultDataSource();
  assert.equal(d, cytekDataSource);
  const s = summarize(d);
  assert.equal(s.id, "cytek");
  assert.equal(s.name, "Cytek");
  assert.equal(s.isDefault, true);
  assert.equal(s.assetCount, 9635);
  assert.equal(s.productCount, 5178);
  assert.deepEqual(s.sourceFiles, ["Cytek Quoting Tool - Rev6.xlsx", "Cytek Quoting Tool - Rev5.xlsx"]);
});
