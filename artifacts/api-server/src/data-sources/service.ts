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
import type { DataSource, DataSourceSummary, SeedDataSource, StoredDataSource, DataSourceManifest } from "./types.js";
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
  /** Names (never values) of the environment variables the server considered for its database, and any connection error. */
  storage: StorageDiagnostics;
  /** Built-in sources and whether each is present, so a missing one can be restored. */
  seeds: SeedStatus[];
  /** The raw default-source setting (null when unset), for diagnosing an unexpected default. */
  defaultSetting: string | null;
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
const deletedKey = (id: string) => `deleted:${id}`;

/** Status of a built-in (seeded) source, so a missing one can be explained and restored. */
export interface SeedStatus {
  id: string;
  name: string;
  present: boolean;
  /** When the app seeded it into this store (null if never). */
  seededAt: string | null;
  /** When it was deleted through the app (null if never, or if it vanished some other way). */
  deletedAt: string | null;
}

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
    const { manifest, problem } = normalizeManifest(h.manifest, h.id);
    if (problem) {
      console.warn(`[data-sources] Source "${h.id}" has a malformed stored manifest: ${problem}`);
      if (!storageDiagnostics.malformedSources.includes(h.id)) storageDiagnostics = { ...storageDiagnostics, malformedSources: [...storageDiagnostics.malformedSources, h.id] };
    } else if (storageDiagnostics.malformedSources.includes(h.id)) {
      storageDiagnostics = { ...storageDiagnostics, malformedSources: storageDiagnostics.malformedSources.filter((x) => x !== h.id) };
    }
    return {
      id: h.id,
      name: h.name,
      isDefault: h.id === defaultId,
      quoteProfile: profile,
      importedAt: manifest.importedAt || h.updatedAt,
      updatedAt: h.updatedAt,
      sourceFiles: manifest.sources.map((s) => s?.label ?? s?.fileName ?? "").filter(Boolean),
      assetCount: manifest.counts.assets ?? 0,
      productCount: manifest.counts.products ?? 0,
      unpricedProductCount: manifest.counts.unpricedProducts ?? 0,
      ...(problem ? { warning: `Stored record is incomplete (${problem}). Re-import its workbook with Update workbook to repair it.` } : {}),
    };
  }

  async list(): Promise<DataSourceListing> {
    const all = await this.headers();
    const defaultId = await this.getDefaultId();
    const dataSources = (
      await Promise.all(all.map(async (h) => this.summarize(h, defaultId, summarizeQuoteProfile(await this.store.getProfile(h.id).catch((err) => {
        console.warn(`[data-sources] Could not read the Quote Profile of "${h.id}": ${err instanceof Error ? err.message : String(err)}`);
        return null;
      })))))
    ).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
    const present = new Set(all.map((h) => h.id));
    const seeds: SeedStatus[] = await Promise.all(
      this.seeds.map(async (seed) => ({
        id: seed.id,
        name: seed.name,
        present: present.has(seed.id),
        seededAt: await this.store.getSetting(seededKey(seed.id)),
        deletedAt: await this.store.getSetting(deletedKey(seed.id)),
      })),
    );
    return {
      dataSources,
      defaultId,
      persistent: this.store.persistent,
      storeKind: this.store.kind,
      storage: { ...getStorageDiagnostics(), migration: await this.migrationNote() },
      seeds,
      defaultSetting: await this.store.getSetting(DEFAULT_SOURCE_KEY),
    };
  }

  private async migrationNote(): Promise<string> {
    try {
      const report = await this.store.migration?.();
      return report ? `On ${new Date(report.at).toLocaleString("en-US", { timeZone: "UTC" })} UTC the app adopted the data left in its previous tables: ${report.notes.join("; ")}.` : "";
    } catch (err) {
      return `Could not read the migration record: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * Puts a built-in source back exactly as shipped (data + Quote Profile)
   * after it was deleted. Only seeds can be restored, and only when absent.
   */
  async restoreSeed(id: string): Promise<DataSourceSummary> {
    await this.ensureSeeded();
    const seed = this.seeds.find((s) => s.id === id);
    if (!seed) throw new DataSourceError(404, `"${id}" is not a built-in data source.`);
    if ((await this.store.getVersion(id)) !== null) throw new DataSourceError(409, `"${seed.name}" is already present.`);
    const { quoteProfile, ...record } = seed;
    await this.store.put(record);
    if (quoteProfile) await this.store.setProfile(id, quoteProfile);
    await this.adoptAsDefaultIfNone(id);
    await this.store.setSetting(deletedKey(id), null);
    console.info(`[data-sources] Restored built-in source "${id}".`);
    this.cache.delete(id);
    return this.summary(id);
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
    const ds = createStaticDataSource({ manifest: normalizeManifest(record.manifest, record.id).manifest, assets: record.assets, products: record.products, name: record.name });
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
    // Audit trail: a source that disappears without this marker was not deleted through the app.
    await this.store.setSetting(deletedKey(id), new Date().toISOString());
    console.info(`[data-sources] Deleted source "${id}" (recorded).`);
    this.cache.delete(id);
  }

  /** Test helper: the raw stored record, if any. */
  async getStored(id: string): Promise<StoredDataSource | null> {
    await this.ensureSeeded();
    return this.store.get(id);
  }
}

/**
 * Connection-string variables, in order of preference. `DATABASE_URL` is the
 * documented one; the others are what Vercel's Postgres integrations (Neon,
 * Supabase, the legacy Vercel Postgres) set automatically, so connecting a
 * database in the Vercel dashboard is enough. Integrations can also add a
 * custom prefix (e.g. `STORAGE_DATABASE_URL`), so any variable whose name
 * ends in one of these and whose value is a postgres:// URL is accepted too.
 */
const DATABASE_URL_VARS = ["DATABASE_URL", "POSTGRES_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING", "NEON_DATABASE_URL"];
const PG_PARTS = ["PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE"] as const;

const isPostgresUrl = (v: string | undefined): v is string => !!v && /^postgres(ql)?:\/\//i.test(v.trim());

export interface DatabaseEnv {
  /** Variable the connection came from ("PGHOST…" for component variables). */
  name: string;
  url: string | null;
  /** Names (never values) of every variable that looked database-related, for diagnostics. */
  candidates: string[];
}

/** Which environment variable, if any, provides the Postgres connection. */
export function databaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): DatabaseEnv | null {
  const candidates = Object.keys(env)
    .filter((k) => /(DATABASE|POSTGRES|NEON|^PG)/i.test(k))
    .sort();
  for (const name of DATABASE_URL_VARS) {
    if (isPostgresUrl(env[name])) return { name, url: env[name]!.trim(), candidates };
  }
  // Prefixed variants, pooled ones first.
  const prefixed = candidates
    .filter((k) => /(DATABASE_URL|POSTGRES_URL)$/i.test(k) && isPostgresUrl(env[k]))
    .sort((a, b) => Number(/UNPOOLED|NON_POOLING/i.test(a)) - Number(/UNPOOLED|NON_POOLING/i.test(b)) || a.localeCompare(b));
  if (prefixed.length) return { name: prefixed[0], url: env[prefixed[0]]!.trim(), candidates };
  // Any other *_URL / *_URI holding a postgres URL (e.g. POSTGRES_PRISMA_URL with a prefix).
  const anyUrl = candidates.find((k) => /(URL|URI)$/i.test(k) && isPostgresUrl(env[k]));
  if (anyUrl) return { name: anyUrl, url: env[anyUrl]!.trim(), candidates };
  // Component variables (pg reads PGHOST/PGUSER/PGPASSWORD/PGDATABASE itself).
  if (PG_PARTS.every((k) => env[k]?.trim())) return { name: PG_PARTS.join("/"), url: null, candidates };
  return null;
}

/** What the running server knows about its storage, for the Data Sources page (names only, never values). */
export interface StorageDiagnostics {
  selectedVar: string | null;
  candidateVars: string[];
  lookedFor: string[];
  error: string | null;
  /** Ids of stored sources whose manifest could not be read as saved (repaired for display). */
  malformedSources: string[];
  /** What the store did on first use to adopt data left by an earlier table layout ("" when nothing). */
  migration: string;
}
let storageDiagnostics: StorageDiagnostics = { selectedVar: null, candidateVars: [], lookedFor: DATABASE_URL_VARS, error: null, malformedSources: [], migration: "" };

const EMPTY_COUNTS: DataSourceManifest["counts"] = {
  assets: 0, products: 0, pricedProducts: 0, unpricedProducts: 0, services: 0,
  assetsEnrichedFromSupplement: 0, assetsEnrichedWithDifferentAccountName: 0, assetsFacilityDefaultedToAccount: 0,
};

/**
 * A stored manifest as the code expects it, whatever shape the row actually
 * holds. A manifest saved as a JSON string is decoded; missing pieces are
 * defaulted so the listing can still render the source, and `problem` says
 * what was wrong so it can be shown and fixed. One bad row must never take
 * the whole listing (and the app) down.
 */
export function normalizeManifest(raw: unknown, id: string): { manifest: DataSourceManifest; problem: string | null } {
  let value: unknown = raw;
  let decoded = false;
  for (let i = 0; i < 3 && typeof value === "string"; i++) {
    try {
      value = JSON.parse(value);
      decoded = true;
    } catch {
      break;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const what = raw === null || raw === undefined ? "manifest missing" : `manifest is a ${Array.isArray(value) ? "array" : typeof value}, not an object`;
    return {
      manifest: { id, name: id, importedAt: "", sources: [], counts: EMPTY_COUNTS, rejected: {}, fieldMappings: { assets: {}, products: {} }, notes: [] },
      problem: what,
    };
  }
  const m = value as Partial<DataSourceManifest> & Record<string, unknown>;
  const problems: string[] = [];
  const sources = Array.isArray(m.sources) ? m.sources : (problems.push("sources missing"), []);
  const counts = m.counts && typeof m.counts === "object" ? { ...EMPTY_COUNTS, ...(m.counts as object) } : (problems.push("counts missing"), EMPTY_COUNTS);
  const problem = problems.length ? `${problems.join(", ")} (keys present: ${Object.keys(m).join(", ") || "none"})` : null;
  if (!problems.length && !decoded) return { manifest: value as DataSourceManifest, problem: null };
  return {
    manifest: {
      id: typeof m.id === "string" ? m.id : id,
      name: typeof m.name === "string" ? m.name : id,
      importedAt: typeof m.importedAt === "string" ? m.importedAt : "",
      sources,
      counts,
      rejected: m.rejected && typeof m.rejected === "object" ? (m.rejected as DataSourceManifest["rejected"]) : {},
      fieldMappings: m.fieldMappings && typeof m.fieldMappings === "object" ? (m.fieldMappings as DataSourceManifest["fieldMappings"]) : { assets: {}, products: {} },
      notes: Array.isArray(m.notes) ? (m.notes as string[]) : [],
    },
    problem,
  };
}
export const getStorageDiagnostics = (): StorageDiagnostics => storageDiagnostics;
export const reportStorageError = (err: unknown): void => {
  storageDiagnostics = { ...storageDiagnostics, error: err instanceof Error ? err.message : String(err) };
};

/** Hosted Postgres requires TLS; local databases usually do not offer it. */
export function pgPoolConfig(url: string | null, env: NodeJS.ProcessEnv = process.env): pg.PoolConfig {
  let host = "";
  let hasSslMode = false;
  if (url) {
    try {
      const u = new URL(url);
      host = u.hostname;
      hasSslMode = u.searchParams.has("sslmode") || u.searchParams.has("ssl");
    } catch {
      /* pg will report the malformed URL */
    }
  } else {
    host = env["PGHOST"] ?? "";
    hasSslMode = !!env["PGSSLMODE"];
  }
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
  return {
    ...(url ? { connectionString: url } : {}),
    ...(local || hasSslMode ? {} : { ssl: { rejectUnauthorized: true } }),
    // Serverless: many short-lived function instances share the database, so keep each pool small.
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  };
}

function createStoreFromEnv(): DataSourceStore {
  const db = databaseUrlFromEnv();
  storageDiagnostics = {
    selectedVar: db?.name ?? null,
    candidateVars: Object.keys(process.env).filter((k) => /(DATABASE|POSTGRES|NEON|^PG)/i.test(k)).sort(),
    lookedFor: DATABASE_URL_VARS,
    error: null,
    malformedSources: [],
    migration: "",
  };
  if (db) {
    console.info(`[data-sources] Using Postgres from ${db.name} (persistent).`);
    const pool = new pg.Pool(pgPoolConfig(db.url));
    // An idle pooled connection dropped by the server (routine on serverless +
    // hosted Postgres) emits "error" on the pool; without a listener Node
    // treats it as an unhandled event and the whole function dies.
    pool.on("error", (err) => console.warn(`[data-sources] Idle Postgres connection closed: ${err.message}`));
    return new PgDataSourceStore(pool);
  }
  const dir = process.env["DATA_SOURCES_DIR"];
  if (dir) return new FileDataSourceStore(dir);
  console.warn(
    `[data-sources] No Postgres connection found in the environment (looked for ${DATABASE_URL_VARS.join(", ")}, prefixed variants and PGHOST/PGUSER/PGPASSWORD/PGDATABASE; database-like variables present: ${storageDiagnostics.candidateVars.join(", ") || "none"}) and no DATA_SOURCES_DIR: data sources you add live only in this process's memory. They are lost on restart, and on serverless hosting (Vercel) other function instances will not see them at all.`,
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
