/**
 * The listing must never go down because one stored row is malformed (for
 * example a manifest saved as a JSON string, or a manifest missing fields).
 * Such rows are repaired where possible, reported by id, and never hide the
 * healthy sources.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DataSourceService, DataSourceError, normalizeManifest } from "./service.js";
import { MemoryDataSourceStore } from "./store.js";
import { cytekSeed } from "./cytek/index.js";
import type { DataSourceManifest } from "./types.js";

const good = cytekSeed.manifest;

test("normalizeManifest: well-formed manifests pass through untouched", () => {
  const r = normalizeManifest(good, "cytek");
  assert.equal(r.manifest, good);
  assert.equal(r.problem, null);
});

test("normalizeManifest: a double-encoded manifest is decoded; a broken one is reported and defaulted", () => {
  const encoded = normalizeManifest(JSON.stringify(JSON.stringify(good)), "x");
  assert.deepEqual(encoded.manifest, good, "JSON strings are parsed until an object appears");
  assert.equal(encoded.problem, null);

  const noSources = normalizeManifest({ id: "x", name: "X", importedAt: "2026-01-01T00:00:00Z", counts: { assets: 3, products: 2, unpricedProducts: 1 } } as unknown as DataSourceManifest, "x");
  assert.deepEqual(noSources.manifest.sources, []);
  assert.equal(noSources.manifest.counts.assets, 3);
  assert.match(noSources.problem!, /sources/);

  const garbage = normalizeManifest("not json at all", "x");
  assert.deepEqual(garbage.manifest.sources, []);
  assert.equal(garbage.manifest.counts.assets, 0);
  assert.match(garbage.problem!, /string/);

  const nothing = normalizeManifest(null, "x");
  assert.match(nothing.problem!, /missing/);
});

test("listing survives a malformed row and reports it; healthy rows are unaffected", async () => {
  const store = new MemoryDataSourceStore();
  const svc = new DataSourceService(store, [cytekSeed]);
  await svc.list();
  // Simulate a row written badly: manifest stored as a string with no sources.
  await store.put({ id: "broken", name: "Broken Co", manifest: { id: "broken", name: "Broken Co", importedAt: "2026-01-01T00:00:00Z" } as unknown as DataSourceManifest, assets: [], products: [] });
  const listing = await svc.list();
  const ids = listing.dataSources.map((d) => d.id);
  assert.deepEqual(ids, ["cytek", "broken"]);
  const broken = listing.dataSources.find((d) => d.id === "broken")!;
  assert.deepEqual(broken.sourceFiles, []);
  assert.equal(broken.assetCount, 0);
  assert.match(broken.warning!, /sources/);
  const cytek = listing.dataSources.find((d) => d.id === "cytek")!;
  assert.equal(cytek.warning, undefined);
  assert.equal(cytek.assetCount, 9635);
  assert.deepEqual(listing.storage.malformedSources, ["broken"]);
});

test("deleting records an audit marker; a missing built-in source can be restored as shipped", async () => {
  const store = new MemoryDataSourceStore();
  const svc = new DataSourceService(store, [cytekSeed]);
  let listing = await svc.list();
  assert.deepEqual(listing.seeds.map((s) => [s.id, s.present, s.deletedAt]), [["cytek", true, null]]);
  assert.ok(listing.seeds[0].seededAt);
  assert.equal(listing.defaultSetting, "cytek");

  await svc.delete("cytek");
  listing = await svc.list();
  assert.equal(listing.dataSources.length, 0);
  assert.equal(listing.seeds[0].present, false);
  assert.ok(listing.seeds[0].deletedAt, "deletion through the app is recorded");
  assert.equal(listing.defaultSetting, null, "deleting the default clears the setting");

  const restored = await svc.restoreSeed("cytek");
  assert.equal(restored.name, "Cytek — Current");
  assert.equal(restored.assetCount, 9635);
  assert.equal(restored.quoteProfile.complete, true);
  assert.equal(restored.quoteProfile.termsSectionCount, 14);
  listing = await svc.list();
  assert.deepEqual(listing.seeds.map((s) => [s.present, s.deletedAt]), [[true, null]]);
  assert.equal(listing.defaultSetting, "cytek", "the restored source becomes default when none is set");

  await assert.rejects(svc.restoreSeed("cytek"), (e: DataSourceError) => e.status === 409);
  await assert.rejects(svc.restoreSeed("collab-world-medical"), (e: DataSourceError) => e.status === 404);
});
