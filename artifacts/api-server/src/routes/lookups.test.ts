/**
 * API-level checks for the Manual Mode lookups (serials, asset lookup, parts,
 * data source summary) against the bundled Cytek data.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import app from "../app.js";

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

const get = async (p: string) => {
  const res = await fetch(baseUrl + p);
  return { status: res.status, body: (await res.json()) as any };
};

test("GET /api/data-source describes the default Cytek source", async () => {
  const { status, body } = await get("/api/data-source");
  assert.equal(status, 200);
  assert.equal(body.id, "cytek");
  assert.equal(body.isDefault, true);
  assert.equal(body.assetCount, 9635);
  assert.equal(body.productCount, 5178);
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
});

test("GET /api/parts returns priced products without cost data", async () => {
  const { status, body } = await get("/api/parts");
  assert.equal(status, 200);
  assert.equal(body.parts.length, 5178);
  const flow = body.parts.find((p: any) => p.partNumber === "N0-00011");
  assert.deepEqual(flow, { partName: "Flow Cell Body", partNumber: "N0-00011", listPrice: 268.71, netPrice: 268.71, category: "Parts", unit: "Each" });
  const svc = body.parts.find((p: any) => p.partName === "On-Site Support (2 days)");
  assert.equal(svc.category, "Service");
  assert.equal(svc.listPrice, 7571);
  assert.equal(body.parts.filter((p: any) => p.category === "Service").length, 163);
  assert.ok(body.parts.every((p: any) => p.netPrice === p.listPrice));
});
