import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, renameSync, utimesSync } from "node:fs";
import path from "node:path";
import type { DataSourceStore, StoredDataSourceHeader, StoreKind } from "./store.js";
import type { StoredDataSource } from "./types.js";

const SETTINGS_FILE = "_settings.json";

/**
 * Directory-backed store: <dir>/<id>.json per source plus _settings.json for
 * the default id. Suitable for local development and hosts with a durable
 * disk; not for serverless platforms (use the Postgres store there).
 */
export class FileDataSourceStore implements DataSourceStore {
  readonly kind: StoreKind = "file";
  readonly persistent = true;

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(id: string) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Invalid data source id: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  private readSettings(): { defaultId: string | null } {
    const p = path.join(this.dir, SETTINGS_FILE);
    if (!existsSync(p)) return { defaultId: null };
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      return { defaultId: null };
    }
  }

  private writeSettings(s: { defaultId: string | null }) {
    writeFileSync(path.join(this.dir, SETTINGS_FILE), JSON.stringify(s));
  }

  async list(): Promise<StoredDataSourceHeader[]> {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json") && f !== SETTINGS_FILE)
      .map((f) => {
        const rec = JSON.parse(readFileSync(path.join(this.dir, f), "utf8")) as StoredDataSource;
        return { id: rec.id, name: rec.name, manifest: rec.manifest, updatedAt: rec.updatedAt };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string) {
    const p = this.file(id);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as StoredDataSource;
  }

  async getVersion(id: string) {
    const p = this.file(id);
    return existsSync(p) ? statSync(p).mtime.toISOString() : null;
  }

  async put(record: Omit<StoredDataSource, "updatedAt">) {
    const now = new Date();
    const stored: StoredDataSource = { ...record, updatedAt: now.toISOString() };
    const p = this.file(record.id);
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(stored));
    renameSync(tmp, p);
    // Pin the mtime to updatedAt so getVersion() (a cheap stat) matches the
    // record's version without reading the file.
    utimesSync(p, now, now);
    return stored;
  }

  async delete(id: string) {
    const p = this.file(id);
    if (!existsSync(p)) return false;
    rmSync(p);
    const s = this.readSettings();
    if (s.defaultId === id) this.writeSettings({ defaultId: null });
    return true;
  }

  async getDefaultId() {
    return this.readSettings().defaultId;
  }

  async setDefaultId(id: string | null) {
    this.writeSettings({ defaultId: id });
  }
}
