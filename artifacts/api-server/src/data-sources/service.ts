/**
 * DataSourceService: the one place routes go to for data sources.
 *
 * It merges the built-in sources compiled into the server (today: Cytek) with
 * the user-managed sources kept in a DataSourceStore, resolves which one is
 * the default, caches indexed sources in memory (invalidated by the store's
 * version stamp) and performs imports/replacements/deletions.
 */
import { createHash } from "node:crypto";
import xlsx from "xlsx";
import pg from "pg";
import { activeCompany } from "@workspace/config";
import type { DataSource, DataSourceSummary, StoredDataSource } from "./types.js";
import { createStaticDataSource } from "./static-source.js";
import { importWorkbook } from "./workbook-importer.js";
import { MemoryDataSourceStore, type DataSourceStore } from "./store.js";
import { FileDataSourceStore } from "./file-store.js";
import { PgDataSourceStore } from "./pg-store.js";
import { cytekDataSource } from "./cytek/index.js";

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
  defaultId: string;
  /** false when uploaded sources will not survive a restart (no storage configured). */
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

export class DataSourceService {
  private readonly cache = new Map<string, { version: string; ds: DataSource }>();
  private readonly builtIns: Map<string, DataSource>;

  constructor(
    readonly store: DataSourceStore,
    builtIns: DataSource[],
    private readonly fallbackDefaultId: string,
  ) {
    this.builtIns = new Map(builtIns.map((b) => [b.id, b]));
    if (!this.builtIns.has(fallbackDefaultId)) {
      throw new Error(`Fallback default data source "${fallbackDefaultId}" is not built in`);
    }
  }

  isBuiltIn(id: string): boolean {
    return this.builtIns.has(id);
  }

  async getDefaultId(): Promise<string> {
    const stored = await this.store.getDefaultId();
    if (stored && (this.builtIns.has(stored) || (await this.store.getVersion(stored)) !== null)) return stored;
    return this.fallbackDefaultId;
  }

  private summarize(ds: DataSource, defaultId: string): DataSourceSummary {
    return {
      id: ds.id,
      name: ds.name,
      isDefault: ds.id === defaultId,
      builtIn: this.builtIns.has(ds.id),
      importedAt: ds.manifest.importedAt,
      sourceFiles: ds.manifest.sources.map((s) => s.label),
      assetCount: ds.manifest.counts.assets,
      productCount: ds.manifest.counts.products,
      unpricedProductCount: ds.manifest.counts.unpricedProducts,
    };
  }

  async list(): Promise<DataSourceListing> {
    const defaultId = await this.getDefaultId();
    const stored = await this.store.list();
    const summaries: DataSourceSummary[] = [
      ...[...this.builtIns.values()].map((b) => this.summarize(b, defaultId)),
      ...stored.map((h) => ({
        id: h.id,
        name: h.name,
        isDefault: h.id === defaultId,
        builtIn: false,
        importedAt: h.manifest.importedAt,
        sourceFiles: h.manifest.sources.map((s) => s.label),
        assetCount: h.manifest.counts.assets,
        productCount: h.manifest.counts.products,
        unpricedProductCount: h.manifest.counts.unpricedProducts,
      })),
    ];
    return { dataSources: summaries, defaultId, persistent: this.store.persistent, storeKind: this.store.kind };
  }

  /** Resolves a data source by id, or the default when no id is given. */
  async resolve(id?: string): Promise<DataSource> {
    const wanted = id?.trim() || (await this.getDefaultId());
    const builtIn = this.builtIns.get(wanted);
    if (builtIn) return builtIn;

    const version = await this.store.getVersion(wanted);
    if (version === null) throw new DataSourceError(404, `Unknown data source: ${wanted}`);
    const cached = this.cache.get(wanted);
    if (cached && cached.version === version) return cached.ds;

    const record = await this.store.get(wanted);
    if (!record) throw new DataSourceError(404, `Unknown data source: ${wanted}`);
    const ds = createStaticDataSource({ manifest: record.manifest, assets: record.assets, products: record.products });
    this.cache.set(wanted, { version: record.updatedAt, ds });
    return ds;
  }

  async summary(id?: string): Promise<DataSourceSummary> {
    const ds = await this.resolve(id);
    return this.summarize(ds, await this.getDefaultId());
  }

  private async uniqueId(name: string): Promise<string> {
    const base = slugify(name);
    let candidate = base;
    for (let i = 2; this.builtIns.has(candidate) || (await this.store.getVersion(candidate)) !== null; i++) {
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

  /** Creates a new stored data source from an uploaded workbook. */
  async importFromWorkbook(name: string, upload: WorkbookUpload, opts: { now?: Date } = {}): Promise<DataSourceSummary> {
    const trimmed = name.trim();
    if (!trimmed) throw new DataSourceError(400, "A data source name is required.");
    const id = await this.uniqueId(trimmed);
    const result = this.parseWorkbook(upload, id, trimmed, opts.now);
    await this.store.put({ id, name: trimmed, manifest: result.manifest, assets: result.assets, products: result.products });
    this.cache.delete(id);
    return this.summary(id);
  }

  /** Re-imports an existing stored data source from a newer workbook, keeping its id and name. */
  async replaceWorkbook(id: string, upload: WorkbookUpload, opts: { now?: Date } = {}): Promise<DataSourceSummary> {
    if (this.builtIns.has(id)) {
      throw new DataSourceError(400, `"${id}" is built into the application and cannot be replaced; add a new data source instead.`);
    }
    const existing = await this.store.get(id);
    if (!existing) throw new DataSourceError(404, `Unknown data source: ${id}`);
    const result = this.parseWorkbook(upload, id, existing.name, opts.now);
    await this.store.put({ id, name: existing.name, manifest: result.manifest, assets: result.assets, products: result.products });
    this.cache.delete(id);
    return this.summary(id);
  }

  async setDefault(id: string): Promise<string> {
    if (!this.builtIns.has(id) && (await this.store.getVersion(id)) === null) {
      throw new DataSourceError(404, `Unknown data source: ${id}`);
    }
    await this.store.setDefaultId(id);
    return id;
  }

  async delete(id: string): Promise<void> {
    if (this.builtIns.has(id)) {
      throw new DataSourceError(400, `"${id}" is built into the application and cannot be deleted.`);
    }
    const existed = await this.store.delete(id);
    if (!existed) throw new DataSourceError(404, `Unknown data source: ${id}`);
    this.cache.delete(id);
  }

  /** Test helper: the raw stored record, if any. */
  async getStored(id: string): Promise<StoredDataSource | null> {
    return this.store.get(id);
  }
}

function createStoreFromEnv(): DataSourceStore {
  const url = process.env["DATABASE_URL"];
  if (url) return new PgDataSourceStore(new pg.Pool({ connectionString: url }));
  const dir = process.env["DATA_SOURCES_DIR"];
  if (dir) return new FileDataSourceStore(dir);
  console.warn(
    "[data-sources] No DATABASE_URL or DATA_SOURCES_DIR configured: uploaded data sources will not persist across restarts.",
  );
  return new MemoryDataSourceStore();
}

let singleton: DataSourceService | null = null;

/** The application-wide service, configured from the environment on first use. */
export function getDataSourceService(): DataSourceService {
  if (!singleton) {
    singleton = new DataSourceService(createStoreFromEnv(), [cytekDataSource], activeCompany.dataSourceId ?? cytekDataSource.id);
  }
  return singleton;
}

/** Test helper to swap the service (e.g. for a fresh in-memory store). */
export function setDataSourceService(service: DataSourceService | null): void {
  singleton = service;
}
