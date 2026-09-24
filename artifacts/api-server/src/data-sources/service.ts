/**
 * DataSourceService: the one place routes go to for data sources.
 *
 * Every data source is one persistent, isolated Source of Truth held in a
 * DataSourceStore. On first start the service seeds the store with the data
 * compiled into the server (Cytek); from then on that source is ordinary.
 * The service resolves the default, caches indexed sources in memory
 * (invalidated by the store's version stamp) and performs imports,
 * replacements and deletions.
 */
import { createHash } from "node:crypto";
import xlsx from "xlsx";
import pg from "pg";
import type { DataSource, DataSourceSummary, SeedDataSource, StoredDataSource } from "./types.js";
import {
  normalizeQuoteProfile,
  QuoteProfileError,
  summarizeQuoteProfile,
  type QuoteProfile,
  type QuoteProfileSummary,
} from "./quote-profile.js";
import { createStaticDataSource } from "./static-source.js";
import { importWorkbook } from "./workbook-importer.js";
import { DEFAULT_SOURCE_KEY, MemoryDataSourceStore, type DataSourceStore, type StoredDataSourceHeader } from "./store.js";
import { FileDataSourceStore } from "./file-store.js";
import { PgDataSourceStore } from "./pg-store.js";
import { cytekSeed } from "./cytek/index.js";

export class DataSourceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DataSourceError";
  }
}

export interface WorkbookUpload {
  buffer: Buffer;
  fileName: string;
}

export interface DataSourceListing {
  dataSources: DataSourceSummary[];
  /** null when no data source exists yet. */
  defaultId: string | null;
  /** false when data sources will not survive a restart (no storage configured). */
  persistent: boolean;
  storeKind: DataSourceStore["kind"];
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "data-source";
}

const seededKey = (id: string) => `seeded:${id}`;

export class DataSourceService {
  private readonly cache = new Map<string, { version: string; ds: DataSource }>();
  private seeding: Promise<void> | null = null;

  constructor(
    readonly store: DataSourceStore,
    private readonly seeds: SeedDataSource[] = [],
  ) {}

  /**
   * Saves each seed into the store once. A marker records that seeding
   * happened, so a seed the user later deletes does not come back.
   */
  private ensureSeeded(): Promise<void> {
    if (!this.seeding) {
      this.seeding = (async () => {
        for (const seed of this.seeds) {
          if (await this.store.getSetting(seededKey(seed.id))) continue;
          if ((await this.store.getVersion(seed.id)) === null) {
            const { quoteProfile, ...record } = seed;
            await this.store.put(record);
            if (quoteProfile) await this.store.setProfile(seed.id, quoteProfile);
            await this.adoptAsDefaultIfNone(seed.id);
          }
          await this.store.setSetting(seededKey(seed.id), new Date().toISOString());
        }
      })().catch((err) => {
        this.seeding = null;
        throw err;
      });
    }
    return this.seeding;
  }

  private async headers(): Promise<StoredDataSourceHeader[]> {
    await this.ensureSeeded();
    const all = await this.store.list();
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The first source ever added becomes the default until the user changes it. */
  private async adoptAsDefaultIfNone(id: string): Promise<void> {
    if (!(await this.store.getSetting(DEFAULT_SOURCE_KEY))) await this.store.setSetting(DEFAULT_SOURCE_KEY, id);
  }

  /**
   * The explicit default if it still exists; otherwise (e.g. it was deleted)
   * the first remaining source by name; null when there are none.
   */
  async getDefaultId(): Promise<string | null> {
    const all = await this.headers();
    if (all.length === 0) return null;
    const stored = await this.store.getSetting(DEFAULT_SOURCE_KEY);
    if (stored && all.some((h) => h.id === stored)) return stored;
    return all[0].id;
  }

  private summarize(h: StoredDataSourceHeader, defaultId: string | null, profile: QuoteProfileSummary): DataSourceSummary {
    return {
      id: h.id,
      name: h.name,
      isDefault: h.id === defaultId,
      quoteProfile: profile,
      importedAt: h.manifest.importedAt,
      updatedAt: h.updatedAt,
      sourceFiles: h.manifest.sources.map((s) => s.label),
      assetCount: h.manifest.counts.assets,
      productCount: h.manifest.counts.products,
      unpricedProductCount: h.manifest.counts.unpricedProducts,
    };
  }

  async list(): Promise<DataSourceListing> {
    const all = await this.headers();
    const defaultId = await this.getDefaultId();
    const dataSources = (
      await Promise.all(all.map(async (h) => this.summarize(h, defaultId, summarizeQuoteProfile(await this.store.getProfile(h.id)))))
    ).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
    return { dataSources, defaultId, persistent: this.store.persistent, storeKind: this.store.kind };
  }

  /**
   * Resolves one data source by id (or the default when no id is given).
   * Lookups only ever run against the resolved source: sources are never
   * merged or cross-referenced.
   */
  async resolve(id?: string): Promise<DataSource> {
    await this.ensureSeeded();
    const wanted = id?.trim() || (await this.getDefaultId());
    if (!wanted) throw new DataSourceError(404, "No data sources configured. Add one on the Data Sources page.");

    const version = await this.store.getVersion(wanted);
    if (version === null) throw new DataSourceError(404, `Unknown data source: ${wanted}`);
    const cached = this.cache.get(wanted);
    if (cached && cached.version === version) return cached.ds;

    const record = await this.store.get(wanted);
    if (!record) throw new DataSourceError(404, `Unknown data source: ${wanted}`);
    const ds = createStaticDataSource({ manifest: record.manifest, assets: record.assets, products: record.products, name: record.name });
    this.cache.set(wanted, { version: record.updatedAt, ds });
    return ds;
  }

  async summary(id?: string): Promise<DataSourceSummary> {
    const ds = await this.resolve(id);
    const header = (await this.headers()).find((h) => h.id === ds.id);
    if (!header) throw new DataSourceError(404, `Unknown data source: ${ds.id}`);
    return this.summarize(header, await this.getDefaultId(), summarizeQuoteProfile(await this.store.getProfile(ds.id)));
  }

  /** The seller identity for a source, or null when none has been set up yet. Never falls back to another source. */
  async getProfile(id: string): Promise<QuoteProfile | null> {
    await this.ensureSeeded();
    if ((await this.store.getVersion(id)) === null) throw new DataSourceError(404, `Unknown data source: ${id}`);
    return this.store.getProfile(id);
  }

  async setProfile(id: string, input: unknown): Promise<QuoteProfile> {
    await this.ensureSeeded();
    if ((await this.store.getVersion(id)) === null) throw new DataSourceError(404, `Unknown data source: ${id}`);
    let profile: QuoteProfile;
    try {
      profile = normalizeQuoteProfile(input);
    } catch (err) {
      if (err instanceof QuoteProfileError) throw new DataSourceError(400, err.message);
      throw err;
    }
    await this.store.setProfile(id, profile);
    return profile;
  }

  private async uniqueId(name: string): Promise<string> {
    const base = slugify(name);
    let candidate = base;
    for (let i = 2; (await this.store.getVersion(candidate)) !== null; i++) {
      candidate = `${base}-${i}`;
    }
    return candidate;
  }

  private parseWorkbook(upload: WorkbookUpload, id: string, name: string, now?: Date) {
    let wb: xlsx.WorkBook;
    try {
      wb = xlsx.read(upload.buffer, { type: "buffer" });
    } catch {
      throw new DataSourceError(400, "Could not read the file as an Excel workbook (.xlsx/.xls).");
    }
    try {
      return importWorkbook({
        id,
        name,
        now,
        primary: {
          workbook: wb,
          file: { fileName: upload.fileName, label: upload.fileName, sha256: createHash("sha256").update(upload.buffer).digest("hex") },
        },
      });
    } catch (err) {
      throw new DataSourceError(400, err instanceof Error ? err.message : String(err));
    }
  }

  /** Creates a new data source from an uploaded workbook (the one-time import). */
  async importFromWorkbook(name: string, upload: WorkbookUpload, opts: { now?: Date } = {}): Promise<DataSourceSummary> {
    await this.ensureSeeded();
    const trimmed = name.trim();
    if (!trimmed) throw new DataSourceError(400, "A data source name is required.");
    const id = await this.uniqueId(trimmed);
    const result = this.parseWorkbook(upload, id, trimmed, opts.now);
    await this.store.put({ id, name: trimmed, manifest: result.manifest, assets: result.assets, products: result.products });
    await this.adoptAsDefaultIfNone(id);
    this.cache.delete(id);
    return this.summary(id);
  }

  /** Re-imports an existing data source from a newer workbook, keeping its id and name. */
  async replaceWorkbook(id: string, upload: WorkbookUpload, opts: { now?: Date } = {}): Promise<DataSourceSummary> {
    await this.ensureSeeded();
    const existing = await this.store.get(id);
    if (!existing) throw new DataSourceError(404, `Unknown data source: ${id}`);
    const result = this.parseWorkbook(upload, id, existing.name, opts.now);
    await this.store.put({ id, name: existing.name, manifest: result.manifest, assets: result.assets, products: result.products });
    this.cache.delete(id);
    return this.summary(id);
  }

  /** Renames a data source (id, data and Quote Profile are unchanged). */
  async rename(id: string, name: string): Promise<DataSourceSummary> {
    await this.ensureSeeded();
    const trimmed = (name ?? "").trim();
    if (!trimmed) throw new DataSourceError(400, "A data source name is required.");
    const existing = await this.store.get(id);
    if (!existing) throw new DataSourceError(404, `Unknown data source: ${id}`);
    if (trimmed !== existing.name) {
      await this.store.put({ id, name: trimmed, manifest: existing.manifest, assets: existing.assets, products: existing.products });
      this.cache.delete(id);
    }
    return this.summary(id);
  }

  async setDefault(id: string): Promise<string> {
    await this.ensureSeeded();
    if ((await this.store.getVersion(id)) === null) throw new DataSourceError(404, `Unknown data source: ${id}`);
    await this.store.setSetting(DEFAULT_SOURCE_KEY, id);
    return id;
  }

  async delete(id: string): Promise<void> {
    await this.ensureSeeded();
    const existed = await this.store.delete(id);
    if (!existed) throw new DataSourceError(404, `Unknown data source: ${id}`);
    this.cache.delete(id);
  }

  /** Test helper: the raw stored record, if any. */
  async getStored(id: string): Promise<StoredDataSource | null> {
    await this.ensureSeeded();
    return this.store.get(id);
  }
}

function createStoreFromEnv(): DataSourceStore {
  const url = process.env["DATABASE_URL"];
  if (url) return new PgDataSourceStore(new pg.Pool({ connectionString: url }));
  const dir = process.env["DATA_SOURCES_DIR"];
  if (dir) return new FileDataSourceStore(dir);
  console.warn(
    "[data-sources] No DATABASE_URL or DATA_SOURCES_DIR configured: data sources you add will not persist across restarts (the seeded Cytek source is re-created on every start).",
  );
  return new MemoryDataSourceStore();
}

let singleton: DataSourceService | null = null;

/** The application-wide service, configured from the environment on first use. */
export function getDataSourceService(): DataSourceService {
  if (!singleton) singleton = new DataSourceService(createStoreFromEnv(), [cytekSeed]);
  return singleton;
}

/** Test helper to swap the service (e.g. for a fresh in-memory store). */
export function setDataSourceService(service: DataSourceService | null): void {
  singleton = service;
}
