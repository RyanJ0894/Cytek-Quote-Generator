/**
 * API-level checks for the Manual Mode lookups (serials, asset lookup, parts,
 * data sources) against the bundled Cytek data and an uploaded source.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import app from "../app.js";
import { DataSourceService, setDataSourceService } from "../data-sources/service.js";
import { MemoryDataSourceStore } from "../data-sources/store.js";
import { cytekDataSource } from "../data-sources/cytek/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REV6 = readFileSync(path.join(here, "..", "data-sources", "cytek", "source", "cytek-quoting-tool-rev6.xlsx"));

let server: http.Server;
let baseUrl = "";
before(async () => {
  setDataSourceService(new DataSourceService(new MemoryDataSourceStore(), [cytekDataSource], "cytek"));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const get = async (p: string) => {
  const res = await fetch(baseUrl + p);
  return { status: res.status, body: (await res.json()) as any };
};

test("GET /api/data-source describes the default Cytek source", async () => {
  const { status, body } = await get("/api/data-source");
  assert.equal(status, 200);
  assert.equal(body.id, "cytek");
  assert.equal(body.isDefault, true);
  assert.equal(body.builtIn, true);
  assert.equal(body.assetCount, 9635);
  assert.equal(body.productCount, 5419);
  assert.equal(body.unpricedProductCount, 239);
});

test("GET /api/assets/serials lists every imported serial", async () => {
  const { status, body } = await get("/api/assets/serials");
  assert.equal(status, 200);
  assert.equal(body.serials.length, 9635);
  assert.ok(body.serials.includes("U1399"), "existing serial");
  assert.ok(body.serials.includes("NE0006"), "Rev6-only serial");
  assert.ok(!body.serials.includes("8470060146"), "Rev5-only serial is gone");
});

test("GET /api/assets/lookup: previously supported serial keeps its populated fields", async () => {
  const { status, body } = await get("/api/assets/lookup?serial=u1399");
  assert.equal(status, 200);
  const a = body.asset;
  assert.equal(a.serialNumber, "U1399");
  assert.equal(a.accountName, "Ragon Institute of MGH MIT and Harvard");
  assert.equal(a.facilityName, "RGON");
  assert.equal(a.street, "Ragon Institute of MGH MIT and Harvard - 600 Main St");
  assert.equal(a.city, "Cambridge");
  assert.equal(a.stateZip, "Massachusetts 02139");
  assert.equal(a.contractType, "Premium");
  assert.equal(a.contractEndDate, "2026-06-24");
  assert.equal(a.contractStatus, "Expired", "derived: contract ended 2026-06-24");
  assert.equal(a.productName, "Cytek Aurora? 5L UV/V/B/YG/R");
});

test("GET /api/assets/lookup: Rev6-only serials resolve", async () => {
  for (const [serial, account, contract] of [
    ["NE0006", "Medical Company Empirica", "Warranty"],
    ["N0701", "AGBL Dubai", "Premium"],
    ["Y0957", "AGBL Dubai", "Warranty (Parts Only)"],
  ]) {
    const { status, body } = await get(`/api/assets/lookup?serial=${serial}`);
    assert.equal(status, 200, serial);
    assert.equal(body.asset.accountName, account);
    assert.equal(body.asset.contractType, contract);
    assert.equal(body.asset.facilityName, account, "facility defaults to account when no code is known");
  }
});

test("GET /api/assets/lookup: unknown and missing serials", async () => {
  assert.equal((await get("/api/assets/lookup?serial=NOPE-000")).status, 404);
  assert.equal((await get("/api/assets/lookup?serial=8470060146")).status, 404, "Rev5-only serial");
  assert.equal((await get("/api/assets/lookup")).status, 400);
  assert.equal((await get("/api/assets/lookup?serial=U1399&dataSource=nope")).status, 404, "unknown data source");
});

test("GET /api/parts: priced parts, services and flagged unpriced items; no cost data", async () => {
  const { status, body } = await get("/api/parts");
  assert.equal(status, 200);
  assert.equal(body.parts.length, 5419);
  const flow = body.parts.find((p: any) => p.partNumber === "N0-00011");
  assert.deepEqual(flow, { partName: "Flow Cell Body", partNumber: "N0-00011", listPrice: 268.71, netPrice: 268.71, category: "Parts", unit: "Each", priced: true });
  const svc = body.parts.find((p: any) => p.partName === "On-Site Support (2 days)");
  assert.equal(svc.category, "Service");
  assert.equal(svc.listPrice, 7571);
  assert.equal(body.parts.filter((p: any) => p.category === "Service").length, 164);
  const unpriced = body.parts.filter((p: any) => p.priced === false);
  assert.equal(unpriced.length, 239);
  assert.ok(unpriced.every((p: any) => p.listPrice === 0));
  assert.ok(unpriced.some((p: any) => p.partName === "Basic contract deductible"));
  assert.ok(body.parts.every((p: any) => p.netPrice === p.listPrice));
  // exact part-number lookups the form performs by substring match
  assert.equal(body.parts.filter((p: any) => p.partNumber === "N9-90007").length, 1);
  assert.equal(body.parts.filter((p: any) => p.partNumber === "60020").length, 1, "numeric part numbers are strings");
});

test("work types (services) available to the Service Type search", async () => {
  const { body } = await get("/api/parts");
  const services = body.parts.filter((p: any) => p.category === "Service");
  for (const [name, price] of [
    ["On-Site Support (2 days)", 7571],
    ["Value contract deductible", 750],
    ["Aurora 5 Laser - UV/V/B/YG/R - Premium", 41460],
    ["NL 1000 - Premium", 7999],
    ["Travel", 350],
  ]) {
    const s = services.find((p: any) => p.partName === name);
    assert.ok(s, `${name} should be a service`);
    assert.equal(s.listPrice, price, `${name} price`);
  }
  // unpriced placeholder rows stay out of the service list but remain searchable as products
  assert.equal(services.find((p: any) => p.partName === "Basic contract deductible"), undefined);
  assert.equal(body.parts.find((p: any) => p.partName === "Basic contract deductible")?.priced, false);
});

test("data sources: upload once, query by id, set default, delete", async () => {
  const form = new FormData();
  form.append("name", "Cytek Rev6 upload");
  form.append("file", new Blob([REV6]), "Cytek Quoting Tool - Rev6.xlsx");
  const created = await fetch(`${baseUrl}/api/data-sources`, { method: "POST", body: form });
  assert.equal(created.status, 201);
  const summary = (await created.json()) as any;
  assert.equal(summary.id, "cytek-rev6-upload");
  assert.equal(summary.assetCount, 9635);

  let listing = (await get("/api/data-sources")).body;
  assert.deepEqual(listing.dataSources.map((d: any) => d.id), ["cytek", "cytek-rev6-upload"]);
  assert.equal(listing.defaultId, "cytek");
  assert.equal(listing.persistent, false);
  assert.equal(listing.storeKind, "memory");

  const viaId = await get("/api/assets/lookup?serial=U1399&dataSource=cytek-rev6-upload");
  assert.equal(viaId.status, 200);
  assert.equal(viaId.body.asset.facilityName, "Ragon Institute of MGH MIT and Harvard", "uploaded source has no Rev5 facility codes");
  assert.equal((await get("/api/assets/serials?dataSource=cytek-rev6-upload")).body.serials.length, 9635);
  assert.equal((await get("/api/parts?dataSource=cytek-rev6-upload")).body.parts.length, 5419);

  const setDefault = await fetch(`${baseUrl}/api/data-sources/cytek-rev6-upload/default`, { method: "POST" });
  assert.equal(setDefault.status, 200);
  assert.equal((await get("/api/data-source")).body.id, "cytek-rev6-upload");
  assert.equal((await get("/api/assets/lookup?serial=U1399")).body.asset.facilityName, "Ragon Institute of MGH MIT and Harvard");

  assert.equal((await fetch(`${baseUrl}/api/data-sources/cytek`, { method: "DELETE" })).status, 400, "built-in cannot be deleted");
  assert.equal((await fetch(`${baseUrl}/api/data-sources/cytek-rev6-upload`, { method: "DELETE" })).status, 204);
  listing = (await get("/api/data-sources")).body;
  assert.equal(listing.dataSources.length, 1);
  assert.equal(listing.defaultId, "cytek");

  const bad = new FormData();
  bad.append("name", "Bad");
  bad.append("file", new Blob([Buffer.from("nope")]), "bad.xlsx");
  const badRes = await fetch(`${baseUrl}/api/data-sources`, { method: "POST", body: bad });
  assert.equal(badRes.status, 400);
  const missingName = new FormData();
  missingName.append("file", new Blob([REV6]), "x.xlsx");
  assert.equal((await fetch(`${baseUrl}/api/data-sources`, { method: "POST", body: missingName })).status, 400);
});
