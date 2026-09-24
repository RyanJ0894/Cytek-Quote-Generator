import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, renameSync, utimesSync } from "node:fs";
import path from "node:path";
import { DEFAULT_SOURCE_KEY, type DataSourceStore, type StoredDataSourceHeader, type StoreKind } from "./store.js";
import type { StoredDataSource } from "./types.js";
import type { QuoteProfile } from "./quote-profile.js";

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

  private profileFile(id: string) {
    return this.file(id).replace(/\.json$/, ".profile.json");
  }

  private readSettings(): Record<string, string> {
    const p = path.join(this.dir, SETTINGS_FILE);
    if (!existsSync(p)) return {};
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      return {};
    }
  }

  private writeSettings(s: Record<string, string>) {
    writeFileSync(path.join(this.dir, SETTINGS_FILE), JSON.stringify(s));
  }

  async list(): Promise<StoredDataSourceHeader[]> {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".profile.json") && f !== SETTINGS_FILE)
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
    rmSync(this.profileFile(id), { force: true });
    if ((await this.getSetting(DEFAULT_SOURCE_KEY)) === id) await this.setSetting(DEFAULT_SOURCE_KEY, null);
    return true;
  }

  async getProfile(id: string) {
    const p = this.profileFile(id);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as QuoteProfile;
  }

  async setProfile(id: string, profile: QuoteProfile | null) {
    const p = this.profileFile(id);
    if (profile === null) {
      rmSync(p, { force: true });
      return;
    }
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(profile));
    renameSync(tmp, p);
  }

  async getSetting(key: string) {
    return this.readSettings()[key] ?? null;
  }

  async setSetting(key: string, value: string | null) {
    const s = this.readSettings();
    if (value === null) delete s[key];
    else s[key] = value;
    this.writeSettings(s);
  }
}
