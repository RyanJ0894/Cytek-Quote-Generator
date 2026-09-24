/**
 * DataSourceService + the three stores, exercised with the real Cytek
 * workbooks: seed on first start, import once, look up, switch default,
 * replace, delete down to the zero state, and persistence across instances.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { DataSourceError, DataSourceService, slugify } from "./service.js";
import { MemoryDataSourceStore, type DataSourceStore } from "./store.js";
import { FileDataSourceStore } from "./file-store.js";
import { PgDataSourceStore } from "./pg-store.js";
import { cytekSeed } from "./cytek/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REV6 = readFileSync(path.join(here, "cytek", "source", "cytek-quoting-tool-rev6.xlsx"));
const REV5 = readFileSync(path.join(here, "cytek", "source", "cytek-quoting-tool-rev5.xlsx"));

test("slugify makes safe ids", () => {
  assert.equal(slugify("Cytek — Current (2026)"), "cytek-current-2026");
  assert.equal(slugify("   "), "data-source");
});

async function exerciseService(store: DataSourceStore) {
  const svc = new DataSourceService(store, [cytekSeed]);

  // First start: the seed is saved into the store and is the default.
  let listing = await svc.list();
  assert.deepEqual(listing.dataSources.map((d) => [d.id, d.name, d.isDefault]), [["cytek", "Cytek — Current", true]]);
  assert.equal(listing.defaultId, "cytek");
  assert.equal((await svc.resolve()).listSerials().length, 9635);
  assert.equal((await svc.resolve()).lookupAsset("U1399")?.facilityName, "RGON", "seed keeps the Rev5 facility codes");

  // One-time upload of a second, isolated source (Rev5 data as "Company B").
  const created = await svc.importFromWorkbook("Company B", { buffer: REV5, fileName: "company-b.xlsx" });
  assert.equal(created.id, "company-b");
  assert.equal(created.assetCount, 3585);
  assert.equal(created.isDefault, false);

  // Isolation: each source answers only from its own records.
  const a = await svc.resolve("cytek");
  const b = await svc.resolve("company-b");
  assert.ok(a.lookupAsset("NE0006"), "Rev6-only serial in A");
  assert.equal(b.lookupAsset("NE0006"), null, "…and not in B");
  assert.ok(b.lookupAsset("8470060146"), "Rev5-only serial in B");
  assert.equal(a.lookupAsset("8470060146"), null, "…and not in A");
  assert.equal(a.listSerials().length + b.listSerials().length, 9635 + 3585);

  // Cached until the record changes.
  assert.equal(await svc.resolve("company-b"), b);

  // Default switching.
  await svc.setDefault("company-b");
  listing = await svc.list();
  assert.equal(listing.defaultId, "company-b");
  assert.equal(listing.dataSources[0].id, "company-b", "default is listed first");
  assert.equal((await svc.resolve()).id, "company-b");

  // Name collisions get distinct ids.
  const second = await svc.importFromWorkbook("Company B", { buffer: REV6, fileName: "rev6.xlsx" });
  assert.equal(second.id, "company-b-2");

  // Replace a source's workbook: id and name kept, data swapped, cache refreshed.
  const replaced = await svc.replaceWorkbook("company-b", { buffer: REV6, fileName: "rev6.xlsx" });
  assert.equal(replaced.name, "Company B");
  assert.equal(replaced.assetCount, 9635);
  const after = await svc.resolve("company-b");
  assert.notEqual(after, b);
  assert.ok(after.lookupAsset("NE0006"));

  // The seeded source is an ordinary source: it can be replaced too.
  const seedReplaced = await svc.replaceWorkbook("cytek", { buffer: REV5, fileName: "rev5.xlsx" });
  assert.equal(seedReplaced.assetCount, 3585);

  // Errors.
  await assert.rejects(svc.resolve("nope"), (e: DataSourceError) => e.status === 404);
  await assert.rejects(svc.setDefault("nope"), (e: DataSourceError) => e.status === 404);
  await assert.rejects(svc.replaceWorkbook("nope", { buffer: REV6, fileName: "x.xlsx" }), (e: DataSourceError) => e.status === 404);
  await assert.rejects(svc.importFromWorkbook("", { buffer: REV6, fileName: "x.xlsx" }), (e: DataSourceError) => e.status === 400);
  await assert.rejects(
    svc.importFromWorkbook("Bad", { buffer: Buffer.from("not a workbook"), fileName: "bad.xlsx" }),
    (e: DataSourceError) => e.status === 400,
  );

  // Delete everything: default falls back to whatever remains, then to none.
  await svc.delete("company-b");
  assert.equal((await svc.list()).defaultId, "company-b-2", "first remaining by name");
  await svc.delete("company-b-2");
  await svc.delete("cytek");
  listing = await svc.list();
  assert.deepEqual(listing.dataSources, []);
  assert.equal(listing.defaultId, null);
  await assert.rejects(svc.resolve(), (e: DataSourceError) => e.status === 404 && /No data sources configured/.test(e.message));
  await assert.rejects(svc.delete("cytek"), (e: DataSourceError) => e.status === 404);
  assert.equal(listing.persistent, store.persistent);
}

describe("DataSourceService", () => {
  test("with the in-memory store", async () => {
    await exerciseService(new MemoryDataSourceStore());
  });

  test("with the file store: data and the seeding marker persist across instances", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ds-store-"));
    try {
      await exerciseService(new FileDataSourceStore(dir));
      // The user deleted the seeded source above: a new instance must not bring it back.
      const again = new DataSourceService(new FileDataSourceStore(dir), [cytekSeed]);
      assert.deepEqual((await again.list()).dataSources, []);
      // Persistence check: write with one instance, read with another.
      await again.importFromWorkbook("Persisted", { buffer: REV5, fileName: "rev5.xlsx" });
      await again.setDefault("persisted");
      const b = new DataSourceService(new FileDataSourceStore(dir), [cytekSeed]);
      assert.equal((await b.resolve()).id, "persisted");
      assert.equal((await b.resolve()).listSerials().length, 3585);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("with the Postgres store (embedded PGlite)", async () => {
    const pg = new PGlite();
    after(() => pg.close());
    await exerciseService(new PgDataSourceStore(pg));
    const again = new DataSourceService(new PgDataSourceStore(pg), [cytekSeed]);
    assert.deepEqual((await again.list()).dataSources, [], "deleted seed stays deleted");
    await again.importFromWorkbook("Persisted", { buffer: REV5, fileName: "rev5.xlsx" });
    await again.setDefault("persisted");
    const b = new DataSourceService(new PgDataSourceStore(pg), [cytekSeed]);
    assert.equal((await b.resolve()).id, "persisted");
    assert.equal((await b.resolve()).lookupAsset("U0286")?.facilityName, "MSU");
    const rows = await pg.query<{ id: string; n: number }>("select id, jsonb_array_length(assets) as n from data_sources");
    assert.deepEqual(rows.rows, [{ id: "persisted", n: 3585 }]);
    const settings = await pg.query<{ key: string }>("select key from app_settings order by key");
    assert.deepEqual(settings.rows.map((r) => r.key), ["default_data_source_id", "seeded:cytek"]);
  });

  test("a fresh store seeds Cytek exactly once and keeps it on later starts", async () => {
    const store = new MemoryDataSourceStore();
    const a = new DataSourceService(store, [cytekSeed]);
    assert.equal((await a.list()).dataSources.length, 1);
    const b = new DataSourceService(store, [cytekSeed]);
    assert.equal((await b.list()).dataSources.length, 1);
    assert.equal((await b.resolve("cytek")).name, "Cytek — Current");
  });
});
