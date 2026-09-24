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
import { cytekSeed } from "../data-sources/cytek/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REV6 = readFileSync(path.join(here, "..", "data-sources", "cytek", "source", "cytek-quoting-tool-rev6.xlsx"));
const REV5 = readFileSync(path.join(here, "..", "data-sources", "cytek", "source", "cytek-quoting-tool-rev5.xlsx"));

let server: http.Server;
let baseUrl = "";
before(async () => {
  setDataSourceService(new DataSourceService(new MemoryDataSourceStore(), [cytekSeed]));
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

test("GET /api/data-sources lists the seeded Cytek source as default", async () => {
  const { status, body } = await get("/api/data-sources");
  assert.equal(status, 200);
  assert.equal(body.defaultId, "cytek");
  assert.equal(body.dataSources.length, 1);
  const c = body.dataSources[0];
  assert.equal(c.name, "Cytek — Current");
  assert.equal(c.isDefault, true);
  assert.equal(c.assetCount, 9635);
  assert.equal(c.productCount, 5419);
  assert.equal(c.unpricedProductCount, 239);
  assert.ok(c.updatedAt);
  assert.equal(c.quoteProfile.companyName, "Cytek Biosciences Inc.");
  assert.equal(c.quoteProfile.complete, true);
});

test("quote profile endpoints: read, save, logo", async () => {
  const got = await get("/api/data-sources/cytek/profile");
  assert.equal(got.status, 200);
  assert.equal(got.body.profile.companyName, "Cytek Biosciences Inc.");
  assert.equal(got.body.complete, true);
  const logo = await fetch(`${baseUrl}/api/data-sources/cytek/logo`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get("content-type"), "image/png");
  assert.equal(Buffer.from(await logo.arrayBuffer()).subarray(1, 4).toString(), "PNG");
  assert.equal((await get("/api/data-sources/nope/profile")).status, 404);
});

test("PATCH /api/data-sources/:id renames a source; data and profile untouched", async () => {
  const before = await get("/api/data-sources/cytek/profile");
  let res = await fetch(baseUrl + "/api/data-sources/cytek", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Cytek — Renamed" }) });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as any).name, "Cytek — Renamed");
  const after = await get("/api/data-sources/cytek/profile");
  assert.deepEqual(after.body, before.body, "renaming keeps the Quote Profile");
  assert.equal((await get("/api/assets/serials?dataSource=cytek")).body.serials.length > 9000, true, "renaming keeps the data");
  res = await fetch(baseUrl + "/api/data-sources/cytek", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "  " }) });
  assert.equal(res.status, 400);
  res = await fetch(baseUrl + "/api/data-sources/nope", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) });
  assert.equal(res.status, 404);
  res = await fetch(baseUrl + "/api/data-sources/cytek", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Cytek — Current" }) });
  assert.equal(res.status, 200);
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

test("data sources: upload once, query by id, isolation, set default, delete to zero state", async () => {
  const form = new FormData();
  form.append("name", "Company B");
  form.append("file", new Blob([REV5]), "company-b.xlsx");
  const created = await fetch(`${baseUrl}/api/data-sources`, { method: "POST", body: form });
  assert.equal(created.status, 201);
  const summary = (await created.json()) as any;
  assert.equal(summary.id, "company-b");
  assert.equal(summary.assetCount, 3585);

  let listing = (await get("/api/data-sources")).body;
  assert.deepEqual(listing.dataSources.map((d: any) => d.id), ["cytek", "company-b"]);
  assert.equal(listing.defaultId, "cytek");
  assert.equal(listing.persistent, false);
  assert.equal(listing.storeKind, "memory");

  // Isolation: A (Cytek, Rev6-based) and B (Rev5-based) never leak into each other.
  assert.equal((await get("/api/assets/lookup?serial=NE0006&dataSource=cytek")).status, 200);
  assert.equal((await get("/api/assets/lookup?serial=NE0006&dataSource=company-b")).status, 404);
  assert.equal((await get("/api/assets/lookup?serial=8470060146&dataSource=company-b")).status, 200);
  assert.equal((await get("/api/assets/lookup?serial=8470060146&dataSource=cytek")).status, 404);
  assert.equal((await get("/api/assets/serials?dataSource=company-b")).body.serials.length, 3585);
  assert.equal((await get("/api/assets/serials?dataSource=cytek")).body.serials.length, 9635);
  assert.equal((await get("/api/parts?dataSource=company-b")).body.parts.length, 5419, "Rev5 pricing sheet is identical");
  const viaB = await get("/api/assets/lookup?serial=U1399&dataSource=company-b");
  assert.equal(viaB.body.asset.accountName, "Ragon Institute of MGH MIT and Harvard");
  assert.equal(viaB.body.asset.productName, "Cytek Aurora 5 Laser UV/V/B/YG/R (64 + 3 Channel)", "B's own product name, not A's");

  // Default switching changes what unqualified lookups see.
  assert.equal((await fetch(`${baseUrl}/api/data-sources/company-b/default`, { method: "POST" })).status, 200);
  assert.equal((await get("/api/data-sources")).body.defaultId, "company-b");
  assert.equal((await get("/api/assets/lookup?serial=8470060146")).status, 200);

  // Replace B's workbook with Rev6 -> B now has the Rev6 serials.
  const rep = new FormData();
  rep.append("file", new Blob([REV6]), "rev6.xlsx");
  const replaced = await fetch(`${baseUrl}/api/data-sources/company-b/replace`, { method: "POST", body: rep });
  assert.equal(replaced.status, 200);
  assert.equal(((await replaced.json()) as any).assetCount, 9635);
  assert.equal((await get("/api/assets/lookup?serial=NE0006&dataSource=company-b")).status, 200);

  // Bad uploads.
  const bad = new FormData();
  bad.append("name", "Bad");
  bad.append("file", new Blob([Buffer.from("nope")]), "bad.xlsx");
  assert.equal((await fetch(`${baseUrl}/api/data-sources`, { method: "POST", body: bad })).status, 400);
  const missingName = new FormData();
  missingName.append("file", new Blob([REV6]), "x.xlsx");
  assert.equal((await fetch(`${baseUrl}/api/data-sources`, { method: "POST", body: missingName })).status, 400);

  // Delete down to the zero state (the seeded source is deletable like any other).
  assert.equal((await fetch(`${baseUrl}/api/data-sources/company-b`, { method: "DELETE" })).status, 204);
  assert.equal((await get("/api/data-sources")).body.defaultId, "cytek");
  assert.equal((await fetch(`${baseUrl}/api/data-sources/cytek`, { method: "DELETE" })).status, 204);
  listing = (await get("/api/data-sources")).body;
  assert.deepEqual(listing.dataSources, []);
  assert.equal(listing.defaultId, null);
  const none = await get("/api/assets/serials");
  assert.equal(none.status, 404);
  assert.match(none.body.error, /No data sources configured/);
  assert.equal((await fetch(`${baseUrl}/api/data-sources/nope`, { method: "DELETE" })).status, 404);
});
