/**
 * DataSourceService + the three stores, exercised with the real Rev6
 * workbook: import once, look up, switch default, replace, delete.
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
import { cytekDataSource } from "./cytek/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REV6 = readFileSync(path.join(here, "cytek", "source", "cytek-quoting-tool-rev6.xlsx"));
const REV5 = readFileSync(path.join(here, "cytek", "source", "cytek-quoting-tool-rev5.xlsx"));

test("slugify makes safe ids", () => {
  assert.equal(slugify("Cytek — Current (2026)"), "cytek-current-2026");
  assert.equal(slugify("   "), "data-source");
});

async function exerciseService(store: DataSourceStore) {
  const svc = new DataSourceService(store, [cytekDataSource], "cytek");

  // Initial state: only the built-in source, which is the default.
  let listing = await svc.list();
  assert.deepEqual(listing.dataSources.map((d) => [d.id, d.isDefault, d.builtIn]), [["cytek", true, true]]);
  assert.equal(listing.defaultId, "cytek");
  assert.equal((await svc.resolve()).id, "cytek");

  // Import Rev6 as a new source (one-time upload).
  const created = await svc.importFromWorkbook("Cytek Test", { buffer: REV6, fileName: "Cytek Quoting Tool - Rev6.xlsx" });
  assert.equal(created.id, "cytek-test");
  assert.equal(created.builtIn, false);
  assert.equal(created.assetCount, 9635);
  assert.equal(created.productCount, 5419);
  assert.equal(created.unpricedProductCount, 239);
  assert.equal(created.isDefault, false);
  assert.deepEqual(created.sourceFiles, ["Cytek Quoting Tool - Rev6.xlsx"]);

  // It is queryable by id without any further upload.
  const ds = await svc.resolve("cytek-test");
  assert.equal(ds.listSerials().length, 9635);
  const u1399 = ds.lookupAsset("u1399")!;
  assert.equal(u1399.accountName, "Ragon Institute of MGH MIT and Harvard");
  assert.equal(u1399.facilityName, "Ragon Institute of MGH MIT and Harvard", "no Rev5 supplement for uploaded sources");
  assert.equal(ds.lookupAsset("NE0006")?.contractType, "Warranty");
  assert.equal(ds.listProducts().find((p) => p.partNumber === "N0-00011")?.listPrice, 268.71);
  assert.equal(ds.listServices().length, 164);

  // Same instance is served until the record changes (cache by version).
  assert.equal(await svc.resolve("cytek-test"), ds);

  // Make it the default: unqualified lookups now use it.
  await svc.setDefault("cytek-test");
  listing = await svc.list();
  assert.equal(listing.defaultId, "cytek-test");
  assert.equal((await svc.resolve()).id, "cytek-test");
  assert.equal(listing.dataSources.find((d) => d.id === "cytek")?.isDefault, false);

  // Names collide -> distinct ids.
  const second = await svc.importFromWorkbook("Cytek Test", { buffer: REV5, fileName: "rev5.xlsx" });
  assert.equal(second.id, "cytek-test-2");
  assert.equal(second.assetCount, 3585);

  // Replace the workbook of an uploaded source: id and name kept, data swapped, cache refreshed.
  const replaced = await svc.replaceWorkbook("cytek-test", { buffer: REV5, fileName: "rev5.xlsx" });
  assert.equal(replaced.id, "cytek-test");
  assert.equal(replaced.name, "Cytek Test");
  assert.equal(replaced.assetCount, 3585);
  const after = await svc.resolve("cytek-test");
  assert.notEqual(after, ds);
  assert.equal(after.lookupAsset("U1399")?.facilityName, "RGON");

  // Guard rails.
  await assert.rejects(svc.delete("cytek"), (e: DataSourceError) => e.status === 400);
  await assert.rejects(svc.replaceWorkbook("cytek", { buffer: REV6, fileName: "x.xlsx" }), (e: DataSourceError) => e.status === 400);
  await assert.rejects(svc.resolve("nope"), (e: DataSourceError) => e.status === 404);
  await assert.rejects(svc.setDefault("nope"), (e: DataSourceError) => e.status === 404);
  await assert.rejects(svc.importFromWorkbook("", { buffer: REV6, fileName: "x.xlsx" }), (e: DataSourceError) => e.status === 400);
  await assert.rejects(
    svc.importFromWorkbook("Bad", { buffer: Buffer.from("not a workbook"), fileName: "bad.xlsx" }),
    (e: DataSourceError) => e.status === 400,
  );

  // Delete the default -> default falls back to the built-in source.
  await svc.delete("cytek-test");
  await assert.rejects(svc.resolve("cytek-test"), (e: DataSourceError) => e.status === 404);
  assert.equal((await svc.resolve()).id, "cytek");
  await svc.delete("cytek-test-2");
  listing = await svc.list();
  assert.equal(listing.dataSources.length, 1);
  assert.equal(listing.persistent, store.persistent);
}

describe("DataSourceService", () => {
  test("with the in-memory store", async () => {
    await exerciseService(new MemoryDataSourceStore());
  });

  test("with the file store (survives a new store instance on the same directory)", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ds-store-"));
    try {
      await exerciseService(new FileDataSourceStore(dir));
      // Persistence check: write with one instance, read with another.
      const a = new DataSourceService(new FileDataSourceStore(dir), [cytekDataSource], "cytek");
      await a.importFromWorkbook("Persisted", { buffer: REV5, fileName: "rev5.xlsx" });
      await a.setDefault("persisted");
      const b = new DataSourceService(new FileDataSourceStore(dir), [cytekDataSource], "cytek");
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
    // Persistence check across store instances sharing the database.
    const a = new DataSourceService(new PgDataSourceStore(pg), [cytekDataSource], "cytek");
    await a.importFromWorkbook("Persisted", { buffer: REV5, fileName: "rev5.xlsx" });
    await a.setDefault("persisted");
    const b = new DataSourceService(new PgDataSourceStore(pg), [cytekDataSource], "cytek");
    assert.equal((await b.resolve()).id, "persisted");
    assert.equal((await b.resolve()).lookupAsset("U0286")?.facilityName, "MSU");
    const rows = await pg.query<{ id: string; n: number }>("select id, jsonb_array_length(assets) as n from data_sources");
    assert.deepEqual(rows.rows, [{ id: "persisted", n: 3585 }]);
  });
});
