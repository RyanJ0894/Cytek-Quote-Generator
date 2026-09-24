/**
 * Persistence for user-managed Data Sources.
 *
 * A store keeps whole normalized sources (a few MB of JSON each) plus the id
 * of the default source. Implementations: in-memory (no persistence, used
 * when nothing is configured and in tests), file-backed (a directory of JSON
 * files, for local/dev use) and Postgres (see ./pg-store.ts, for hosted
 * deployments whose filesystem is ephemeral).
 */
import type { DataSourceManifest, StoredDataSource } from "./types.js";

export interface StoredDataSourceHeader {
  id: string;
  name: string;
  manifest: DataSourceManifest;
  updatedAt: string;
}

export type StoreKind = "memory" | "file" | "postgres";

export interface DataSourceStore {
  readonly kind: StoreKind;
  /** false when data does not survive a restart. */
  readonly persistent: boolean;
  list(): Promise<StoredDataSourceHeader[]>;
  get(id: string): Promise<StoredDataSource | null>;
  /** Cheap version check (updatedAt) used to invalidate in-memory caches. */
  getVersion(id: string): Promise<string | null>;
  put(record: Omit<StoredDataSource, "updatedAt">): Promise<StoredDataSource>;
  delete(id: string): Promise<boolean>;
  /** Small key/value settings (default source id, seeding markers). */
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
}

export const DEFAULT_SOURCE_KEY = "default_data_source_id";

export class MemoryDataSourceStore implements DataSourceStore {
  readonly kind: StoreKind = "memory";
  readonly persistent = false;
  private readonly records = new Map<string, StoredDataSource>();
  private readonly settings = new Map<string, string>();

  async list() {
    return [...this.records.values()].map(({ id, name, manifest, updatedAt }) => ({ id, name, manifest, updatedAt }));
  }
  async get(id: string) {
    return this.records.get(id) ?? null;
  }
  async getVersion(id: string) {
    return this.records.get(id)?.updatedAt ?? null;
  }
  async put(record: Omit<StoredDataSource, "updatedAt">) {
    const stored = { ...record, updatedAt: new Date().toISOString() };
    this.records.set(record.id, stored);
    return stored;
  }
  async delete(id: string) {
    const existed = this.records.delete(id);
    if (this.settings.get(DEFAULT_SOURCE_KEY) === id) this.settings.delete(DEFAULT_SOURCE_KEY);
    return existed;
  }
  async getSetting(key: string) {
    return this.settings.get(key) ?? null;
  }
  async setSetting(key: string, value: string | null) {
    if (value === null) this.settings.delete(key);
    else this.settings.set(key, value);
  }
}
