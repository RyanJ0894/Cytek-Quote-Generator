/**
 * The Postgres store owns prefixed tables. A database may already hold
 * unprefixed `data_sources` / `app_settings` / `quote_profiles` tables: either
 * this app's own earlier layout, or a foreign table of another shape (this
 * happened in production: integer ids, so every lookup by id failed). Their
 * readable contents are adopted once, the old tables are left untouched, and
 * a table of the wrong shape under the app's own name is refused outright.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PgDataSourceStore, TABLES } from "./pg-store.js";
import { DataSourceService } from "./service.js";
import { cytekSeed } from "./cytek/index.js";

const asset = (serial: string) => ({ serialNumber: serial, accountName: "Collab", facilityName: "Collab", contactName: "", phone: "", email: "", address: "", cityStateZip: "", modelName: "M1" });
const product = (n: number) => ({ partNumber: `P${n}`, partName: `Part ${n}`, category: "Parts", listPrice: n * 10 });

test("foreign-shaped legacy tables (integer ids) are adopted: rows re-keyed, profile and default follow, seed re-added", async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE data_sources (id serial PRIMARY KEY, name text NOT NULL, manifest jsonb NOT NULL, assets jsonb NOT NULL, products jsonb NOT NULL, created_at timestamptz DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE app_settings (key text PRIMARY KEY, value text NOT NULL);
    CREATE TABLE quote_profiles (data_source_id integer PRIMARY KEY, profile jsonb NOT NULL, updated_at timestamptz DEFAULT now());
  `);
  await db.query(`INSERT INTO data_sources (id, name, manifest, assets, products) VALUES (2, 'Collab World Medical', $1::jsonb, $2::jsonb, $3::jsonb)`, [
    JSON.stringify({ notes: [], counts: { assets: 4, products: 10, unpricedProducts: 0 } }),
    JSON.stringify([asset("A1"), asset("A2"), asset("A3"), asset("A4")]),
    JSON.stringify(Array.from({ length: 10 }, (_, i) => product(i + 1))),
  ]);
  await db.query(`INSERT INTO app_settings VALUES ('seeded:cytek', '2026-09-20T00:00:00Z'), ('default_data_source_id', '2')`);
  await db.query(`INSERT INTO quote_profiles (data_source_id, profile) VALUES (2, $1::jsonb)`, [
    JSON.stringify({ companyName: "Collab World Medical", shortName: "Collab", addressLine: "1 Main St", cityStateZip: "Fremont, CA 94538", phone: "555", email: "q@collab.test", website: "" }),
  ]);

  // The old code path against this database: the lookup by text id is rejected.
  await assert.rejects(db.query(`SELECT updated_at FROM data_sources WHERE id = $1`, ["cytek"]), /invalid input syntax for type integer/);

  const svc = new DataSourceService(new PgDataSourceStore(db as any), [cytekSeed]);
  const listing = await svc.list();
  assert.deepEqual(listing.dataSources.map((d) => d.id).sort(), ["collab-world-medical", "cytek"]);
  const collab = listing.dataSources.find((d) => d.id === "collab-world-medical")!;
  assert.equal(collab.name, "Collab World Medical");
  assert.equal(collab.assetCount, 4);
  assert.equal(collab.productCount, 10);
  assert.match(collab.warning!, /sources/, "the damaged manifest is reported, not hidden");
  assert.equal(collab.quoteProfile.companyName, "Collab World Medical", "the profile followed its source");
  assert.equal(collab.isDefault, true, "the default setting was re-keyed with the row");
  assert.equal(listing.defaultSetting, "collab-world-medical");
  const cytek = listing.dataSources.find((d) => d.id === "cytek")!;
  assert.equal(cytek.assetCount, 9635, "the built-in source is added again because its marker had no row");
  assert.equal(listing.seeds[0].present, true);
  assert.match(listing.storage.migration, /copied 1 source\(s\) from the previous "data_sources" table/);
  assert.match(listing.storage.migration, /stored under id 2; it is now "collab-world-medical"/);

  // Lookups run against the adopted data.
  const ds = await svc.resolve("collab-world-medical");
  assert.equal(ds.lookupAsset("A3")?.serialNumber, "A3");

  // The old tables are untouched, and a second instance does not copy again.
  assert.deepEqual((await db.query<{ id: number; name: string }>(`SELECT id, name FROM data_sources`)).rows, [{ id: 2, name: "Collab World Medical" }]);
  const again = new DataSourceService(new PgDataSourceStore(db as any), [cytekSeed]);
  const second = await again.list();
  assert.deepEqual(second.dataSources.map((d) => d.id).sort(), ["collab-world-medical", "cytek"]);
  assert.equal((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${TABLES.sources}`)).rows[0].n, 2);
  await db.close();
});

test("this app's own earlier (unprefixed, text id) tables are adopted as they are, seeding marker included", async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE data_sources (id text PRIMARY KEY, name text NOT NULL, manifest jsonb NOT NULL, assets jsonb NOT NULL, products jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE app_settings (key text PRIMARY KEY, value text NOT NULL);
    CREATE TABLE quote_profiles (data_source_id text PRIMARY KEY, profile jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
  `);
  await db.query(`INSERT INTO data_sources (id, name, manifest, assets, products) VALUES ('evans-test-medical', 'Evans Test Medical', $1::jsonb, $2::jsonb, $3::jsonb)`, [
    JSON.stringify({ id: "evans-test-medical", name: "Evans Test Medical", importedAt: "2026-09-25T00:00:00Z", sources: [{ label: "evt.xlsx", fileName: "evt.xlsx" }], counts: { assets: 1, products: 1, unpricedProducts: 0 }, notes: [] }),
    JSON.stringify([asset("E1")]),
    JSON.stringify([product(1)]),
  ]);
  // The user had deleted the built-in source on purpose: no row, a seeding marker and a deletion marker.
  await db.query(`INSERT INTO app_settings VALUES ('seeded:cytek', '2026-09-20T00:00:00Z'), ('deleted:cytek', '2026-09-21T00:00:00Z'), ('default_data_source_id', 'evans-test-medical')`);
  const svc = new DataSourceService(new PgDataSourceStore(db as any), [cytekSeed]);
  const listing = await svc.list();
  assert.deepEqual(listing.dataSources.map((d) => [d.id, d.isDefault, d.warning]), [["evans-test-medical", true, undefined], ["cytek", false, undefined]]);
  // The seed's row was not there to copy, so its marker is dropped and the seed is added again; the deletion marker stays as history.
  assert.equal(listing.seeds[0].present, true);
  assert.equal(listing.seeds[0].deletedAt, "2026-09-21T00:00:00Z");
  assert.deepEqual((await svc.list()).dataSources.map((d) => d.id).sort(), ["cytek", "evans-test-medical"]);
  assert.match(listing.storage.migration, /copied 1 source/);
  await db.close();
});

test("a table of the wrong shape under the app's own name is refused with a clear message", async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE ${TABLES.sources} (id integer PRIMARY KEY, name text, manifest jsonb, assets jsonb, products jsonb, updated_at timestamptz)`);
  const store = new PgDataSourceStore(db as any);
  await assert.rejects(store.list(), /unexpected shape \(eqg_data_sources\.id is integer, expected text\)/);
  await db.close();
});
