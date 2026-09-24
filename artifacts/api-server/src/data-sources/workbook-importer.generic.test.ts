/**
 * The importer must handle any properly laid-out workbook, not just the Cytek
 * export: differently named columns, separate State/ZIP, no item-id column,
 * and pricing rows of several kinds (instruments, parts, services, contracts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import xlsx from "xlsx";
import { importWorkbook, classifyProduct, normalizeHeader } from "./workbook-importer.js";

/** A small non-Cytek export: 4 assets, 7 pricing records, generic headers. */
export function genericWorkbook(opts: { categoryColumn?: boolean } = {}): xlsx.WorkBook {
  const assets = [
    ["Serial #", "Customer", "Site", "Model", "Coverage", "Asset Status", "Address", "City", "State", "Zip", "Contact", "Email", "Coverage End Date"],
    ["NF-3000-001", "Riverside Clinic", "Riverside Main", "NovaFlow 3000", "Full Service", "Installed", "12 River Rd", "Austin", "TX", "78701", "Dana Reyes", "dana@riverside.example", "2027-06-30"],
    ["NF-3000-002", "Hill Country Labs", "", "NovaFlow 3000", "Warranty", "Installed", "900 Ranch Way", "Dripping Springs", "TX", "78620", "", "", "2025-01-31"],
    ["NF-5000-010", "Bayou Diagnostics", "Bayou Annex", "NovaFlow 5000", "", "Installed", "45 Marsh Ln", "Houston", "TX", "77002", "Lee Tran", "lee@bayou.example", ""],
    [1002345, "Pecos Research", "Pecos West", "NovaFlow 3000", "Parts Only", "Retired", "1 Desert Dr", "Pecos", "TX", "79772", "", "", "2026-12-31"],
  ];
  const pricing = [
    ["Description", "Part #", "Price", "Unit", ...(opts.categoryColumn ? ["Category"] : [])],
    ["NovaFlow 3000 Instrument", "EQ-NF3000", 28500, "Each", ...(opts.categoryColumn ? ["Equipment"] : [])],
    ["NovaFlow Sample Probe", "PT-NF-101", 310.5, "Each", ...(opts.categoryColumn ? ["Part"] : [])],
    ["Sheath Filter 0.2um (10 pack)", "PT-NF-220", 48, "Each", ...(opts.categoryColumn ? ["Consumable"] : [])],
    ["Laser Shield Support Bracket", "PT-NF-305", 129.99, "Each", ...(opts.categoryColumn ? ["Part"] : [])],
    ["Preventive Maintenance Visit", "SV-PM-01", 1500, "Each", ...(opts.categoryColumn ? ["Service"] : [])],
    ["On-Site Support", "SV-OS-HR", 250, "Hour", ...(opts.categoryColumn ? ["Service"] : [])],
    ["Annual Service Contract", "CT-NF-1Y", 9800, "Year", ...(opts.categoryColumn ? ["Contract"] : [])],
  ];
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(assets), "Asset Data");
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(pricing), "Pricing Data");
  return wb;
}

export function genericWorkbookBuffer(opts: { categoryColumn?: boolean } = {}): Buffer {
  return xlsx.write(genericWorkbook(opts), { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const run = (wb: xlsx.WorkBook) =>
  importWorkbook({ id: "evans-test-medical", name: "Evans Test Medical", primary: { workbook: wb, file: { fileName: "etm.xlsx", label: "etm.xlsx", sha256: "x" } }, now: new Date("2026-09-24T00:00:00Z") });

test("header matching is punctuation/case-insensitive and finds serial-like columns", () => {
  assert.equal(normalizeHeader("Serial #"), "serial");
  assert.equal(normalizeHeader("serial_number"), "serial number");
  assert.equal(normalizeHeader("Contact: Email"), "contact email");
});

test("generic workbook: all 4 assets import with their serials and mapped fields", () => {
  const r = run(genericWorkbook());
  assert.equal(r.assets.length, 4);
  assert.deepEqual(r.assets.map((a) => a.serialNumber), ["NF-3000-001", "NF-3000-002", "NF-5000-010", "1002345"], "serials come from the Serial # column, numeric cells included");
  const a = r.assets[0];
  assert.equal(a.accountName, "Riverside Clinic");
  assert.equal(a.facilityName, "Riverside Main");
  assert.equal(a.productName, "NovaFlow 3000");
  assert.equal(a.contractType, "Full Service");
  assert.equal(a.assetStatus, "Installed");
  assert.equal(a.street, "12 River Rd");
  assert.equal(a.city, "Austin");
  assert.equal(a.stateZip, "TX 78701", "separate State + Zip columns are combined");
  assert.equal(a.contactName, "Dana Reyes");
  assert.equal(a.contactEmail, "dana@riverside.example");
  assert.equal(a.contractEndDate, "2027-06-30");
  assert.equal(r.assets[1].facilityName, "Hill Country Labs", "blank facility falls back to the account");
  assert.equal(r.assets[2].contractType, "", "absent values stay blank, never invented");
  assert.match(r.manifest.fieldMappings.assets.serialNumber, /Serial #/);
  assert.match(r.manifest.fieldMappings.assets.stateZip, /State \+ Zip/);
});

test("generic workbook: the 7 pricing records are classified by unit and name, not by a missing item id", () => {
  const r = run(genericWorkbook());
  assert.equal(r.products.length, 7);
  const cat = Object.fromEntries(r.products.map((p) => [p.partNumber, p.category]));
  assert.deepEqual(cat, {
    "EQ-NF3000": "Instrument",
    "PT-NF-101": "Parts",
    "PT-NF-220": "Parts",
    "PT-NF-305": "Parts", // "Support" in the name, but it is a bracket
    "SV-PM-01": "Service",
    "SV-OS-HR": "Service",
    "CT-NF-1Y": "Service",
  });
  assert.equal(r.manifest.counts.services, 3);
  const nova = r.products.find((p) => p.partNumber === "EQ-NF3000")!;
  assert.deepEqual([nova.partName, nova.listPrice, nova.priced], ["NovaFlow 3000 Instrument", 28500, true]);
  assert.match(r.manifest.fieldMappings.products.category, /by name/);
});

test("generic workbook: an explicit Category column is honored", () => {
  const r = run(genericWorkbook({ categoryColumn: true }));
  const cat = Object.fromEntries(r.products.map((p) => [p.partNumber, p.category]));
  assert.deepEqual(cat, {
    "EQ-NF3000": "Instrument",
    "PT-NF-101": "Parts",
    "PT-NF-220": "Parts",
    "PT-NF-305": "Parts",
    "SV-PM-01": "Service",
    "SV-OS-HR": "Service",
    "CT-NF-1Y": "Service",
  });
  assert.match(r.manifest.fieldMappings.products.category, /Category column/);
});

test("classifyProduct: Cytek-style catalogs keep the item-id rule; keyword rules only apply without it", () => {
  const cytek = { idSignal: true };
  assert.equal(classifyProduct({ name: "Laser Shield Support", unit: "Each", listPrice: 15.09, hasInternalId: true, explicitCategory: "" }, cytek), "Parts");
  assert.equal(classifyProduct({ name: "Aurora Instrument Demo Crate", unit: "Each", listPrice: 100, hasInternalId: true, explicitCategory: "" }, cytek), "Parts");
  assert.equal(classifyProduct({ name: "On-Site Support (2 days)", unit: "", listPrice: 2500, hasInternalId: false, explicitCategory: "" }, cytek), "Service");
  assert.equal(classifyProduct({ name: "Placeholder", unit: "", listPrice: 0, hasInternalId: false, explicitCategory: "" }, cytek), "Parts");
  assert.equal(classifyProduct({ name: "Service Contract - 1 Year", unit: "Year", listPrice: 41460, hasInternalId: true, explicitCategory: "" }, cytek), "Service");
  const generic = { idSignal: false };
  assert.equal(classifyProduct({ name: "NovaFlow 3000 Instrument", unit: "Each", listPrice: 28500, hasInternalId: false, explicitCategory: "" }, generic), "Instrument");
  assert.equal(classifyProduct({ name: "Instrument Filter Kit", unit: "Each", listPrice: 40, hasInternalId: false, explicitCategory: "" }, generic), "Parts");
  assert.equal(classifyProduct({ name: "Extended Warranty Plan", unit: "Each", listPrice: 4200, hasInternalId: false, explicitCategory: "" }, generic), "Service");
  assert.equal(classifyProduct({ name: "Mystery Item", unit: "Each", listPrice: 5, hasInternalId: false, explicitCategory: "" }, generic), "Parts");
  assert.equal(classifyProduct({ name: "Anything", unit: "Each", listPrice: 5, hasInternalId: false, explicitCategory: "Instrument" }, cytek), "Instrument");
});
