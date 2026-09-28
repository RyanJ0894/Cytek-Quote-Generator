import { DEFAULT_SOURCE_KEY, type DataSourceStore, type MigrationReport, type StoredDataSourceHeader, type StoreKind } from "./store.js";
import type { DataSourceManifest, NormalizedAsset, NormalizedProduct, StoredDataSource } from "./types.js";
import type { QuoteProfile } from "./quote-profile.js";

/**
 * The minimal Postgres client surface the store needs. Both `pg.Pool`
 * (production) and `@electric-sql/pglite` (tests) satisfy it structurally,
 * so the store has no ORM dependency and works against either.
 */
export interface SqlClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, params?: any[]): Promise<{ rows: any[] }>;
}

interface Row {
  id: string;
  name: string;
  manifest: unknown;
  assets?: unknown;
  products?: unknown;
  updated_at: string | Date;
}

const iso = (v: string | Date) => new Date(v).toISOString();

/**
 * Table names carry an app prefix. The database may be shared with other
 * applications (a hosted Postgres often is), and a plain `data_sources`
 * table of a different shape (integer ids) once broke production: CREATE
 * TABLE IF NOT EXISTS silently adopted the foreign table.
 */
export const TABLES = { sources: "eqg_data_sources", settings: "eqg_app_settings", profiles: "eqg_quote_profiles" } as const;
/** The unprefixed names this app used before; their contents are adopted once, and the tables are left in place. */
const LEGACY_TABLES = { sources: "data_sources", settings: "app_settings", profiles: "quote_profiles" } as const;
const MIGRATION_KEY = "migrated:legacy-tables";

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "data-source";
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A failure of the socket/session, as opposed to a bad statement. */
export function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code ?? "";
  return (
    /^(ECONNRESET|EPIPE|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|57P01|57P02|57P03|08006|08003|08001|08004)$/.test(code) ||
    /Connection terminated|terminating connection|connection closed|Client has encountered a connection error|timeout exceeded when trying to connect|Connection ended unexpectedly|server closed the connection/i.test(err.message)
  );
}

/** jsonb values come back parsed by pg/PGlite; tolerate a string (even a double-encoded one) just in case. */
function json<T>(v: unknown): T {
  let out: unknown = v;
  for (let i = 0; i < 3 && typeof out === "string"; i++) {
    try {
      out = JSON.parse(out);
    } catch {
      break;
    }
  }
  return out as T;
}

/**
 * Postgres-backed store. Tables are created on first use with
 * CREATE TABLE IF NOT EXISTS (three small tables, see
 * lib/db/src/schema/data-sources.ts for the reference schema), their shape
 * is verified, and rows left by the previous unprefixed tables are adopted
 * once. Whole sources are stored as jsonb and indexed in memory after loading.
 */
export class PgDataSourceStore implements DataSourceStore {
  readonly kind: StoreKind = "postgres";
  readonly persistent = true;
  private ready: Promise<void> | null = null;

  constructor(private readonly client: SqlClient) {}

  /**
   * Runs one statement, retrying once when the *connection* failed rather
   * than the statement. On serverless hosting a function instance is frozen
   * between requests; hosted Postgres (Neon) closes the idle pooled socket in
   * the meantime, and the first query after thawing fails with "Connection
   * terminated unexpectedly" / ECONNRESET. The retry gets a fresh connection.
   */
  private async q(text: string, params?: unknown[]): Promise<{ rows: any[] }> {
    try {
      return await this.client.query(text, params);
    } catch (err) {
      if (!isConnectionError(err)) throw err;
      console.warn(`[data-sources] Postgres connection dropped (${(err as Error).message}); retrying once.`);
      await new Promise((r) => setTimeout(r, 250));
      return await this.client.query(text, params);
    }
  }

  private ensureSchema(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await this.q(`CREATE TABLE IF NOT EXISTS ${TABLES.sources} (
          id text PRIMARY KEY,
          name text NOT NULL,
          manifest jsonb NOT NULL,
          assets jsonb NOT NULL,
          products jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`);
        await this.q(`CREATE TABLE IF NOT EXISTS ${TABLES.settings} (
          key text PRIMARY KEY,
          value text NOT NULL
        )`);
        await this.q(`CREATE TABLE IF NOT EXISTS ${TABLES.profiles} (
          data_source_id text PRIMARY KEY,
          profile jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )`);
        await this.verifyShape();
        await this.adoptLegacyTables();
      })().catch((err) => {
        this.ready = null;
        throw err;
      });
    }
    return this.ready;
  }

  /**
   * CREATE TABLE IF NOT EXISTS keeps whatever table already has that name.
   * Refuse to run on one of another shape instead of failing later, one
   * statement at a time, with errors that point nowhere.
   */
  private async verifyShape(): Promise<void> {
    const expected: Record<string, Record<string, string>> = {
      [TABLES.sources]: { id: "text", name: "text", manifest: "jsonb", assets: "jsonb", products: "jsonb", updated_at: "timestamp with time zone" },
      [TABLES.settings]: { key: "text", value: "text" },
      [TABLES.profiles]: { data_source_id: "text", profile: "jsonb" },
    };
    const { rows } = await this.q(
      `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ANY($1)`,
      [Object.keys(expected)],
    );
    const actual = new Map<string, string>();
    for (const r of rows as { table_name: string; column_name: string; data_type: string }[]) actual.set(`${r.table_name}.${r.column_name}`, r.data_type);
    const problems: string[] = [];
    for (const [table, cols] of Object.entries(expected)) {
      for (const [col, type] of Object.entries(cols)) {
        const got = actual.get(`${table}.${col}`);
        if (got !== type) problems.push(`${table}.${col} is ${got ?? "missing"}, expected ${type}`);
      }
    }
    if (problems.length) {
      throw new Error(`The database tables have an unexpected shape (${problems.join("; ")}). Another application may own these tables; point the app at a database of its own.`);
    }
  }

  /**
   * One-time adoption of rows left in the unprefixed tables by earlier
   * versions of this app. Rows are copied, never moved: the old tables stay
   * untouched. Numeric ids (a foreign table shape) are re-keyed from the
   * name; readable settings and profiles follow their source. Every problem
   * is noted rather than fatal, and the notes are kept for Storage details.
   */
  private async adoptLegacyTables(): Promise<void> {
    const done = await this.q(`SELECT value FROM ${TABLES.settings} WHERE key = $1`, [MIGRATION_KEY]);
    if (done.rows.length) return;
    const notes: string[] = [];
    const { rows: present } = await this.q(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1)`,
      [Object.values(LEGACY_TABLES)],
    );
    const has = new Set((present as { table_name: string }[]).map((r) => r.table_name));
    const idMap = new Map<string, string>();
    if (has.has(LEGACY_TABLES.sources)) {
      try {
        const { rows: ids } = await this.q(`SELECT id::text AS id FROM ${LEGACY_TABLES.sources} ORDER BY id`);
        const { rows: taken } = await this.q(`SELECT id FROM ${TABLES.sources}`);
        const used = new Set((taken as { id: string }[]).map((r) => r.id));
        let copied = 0;
        for (const { id } of ids as { id: string }[]) {
          try {
            const { rows } = await this.q(
              `SELECT id::text AS id, name::text AS name, manifest, assets, products, updated_at FROM ${LEGACY_TABLES.sources} WHERE id::text = $1`,
              [id],
            );
            const r = rows[0] as Row | undefined;
            if (!r) continue;
            const name = r.name || `Data Source ${id}`;
            let newId = /^\d+$/.test(id) ? slug(name) : id;
            for (let n = 2; used.has(newId); n++) newId = `${/^\d+$/.test(id) ? slug(name) : id}-${n}`;
            const manifestRaw = json<unknown>(r.manifest);
            const manifest = manifestRaw && typeof manifestRaw === "object" ? { ...(manifestRaw as object), id: newId, name } : manifestRaw;
            const assets = json<unknown>(r.assets);
            const products = json<unknown>(r.products);
            await this.q(
              `INSERT INTO ${TABLES.sources} (id, name, manifest, assets, products, created_at, updated_at)
               VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $6) ON CONFLICT (id) DO NOTHING`,
              [newId, name, JSON.stringify(manifest ?? null), JSON.stringify(Array.isArray(assets) ? assets : []), JSON.stringify(Array.isArray(products) ? products : []), r.updated_at ? new Date(r.updated_at) : new Date()],
            );
            used.add(newId);
            idMap.set(id, newId);
            copied += 1;
            if (newId !== id) notes.push(`"${name}" was stored under id ${id}; it is now "${newId}"`);
          } catch (err) {
            notes.push(`could not copy source ${id} from the previous "${LEGACY_TABLES.sources}" table: ${errMsg(err)}`);
          }
        }
        notes.unshift(`copied ${copied} source(s) from the previous "${LEGACY_TABLES.sources}" table`);
      } catch (err) {
        notes.push(`could not read the previous "${LEGACY_TABLES.sources}" table: ${errMsg(err)}`);
      }
    }
    if (has.has(LEGACY_TABLES.profiles)) {
      try {
        const { rows } = await this.q(`SELECT data_source_id::text AS id, profile FROM ${LEGACY_TABLES.profiles}`);
        let copied = 0;
        for (const r of rows as { id: string; profile: unknown }[]) {
          const target = idMap.get(r.id) ?? r.id;
          const profile = json<unknown>(r.profile);
          if (!profile || typeof profile !== "object") continue;
          await this.q(
            `INSERT INTO ${TABLES.profiles} (data_source_id, profile, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (data_source_id) DO NOTHING`,
            [target, JSON.stringify(profile)],
          );
          copied += 1;
        }
        notes.push(`copied ${copied} Quote Profile(s)`);
      } catch (err) {
        notes.push(`could not read the previous "${LEGACY_TABLES.profiles}" table: ${errMsg(err)}`);
      }
    }
    if (has.has(LEGACY_TABLES.settings)) {
      try {
        const { rows } = await this.q(`SELECT key::text AS key, value::text AS value FROM ${LEGACY_TABLES.settings}`);
        const adopted = new Set(idMap.values());
        let copied = 0;
        for (const r of rows as { key: string; value: string }[]) {
          if (!r.key || r.value === null || r.value === undefined) continue;
          let value = r.value;
          if (r.key === DEFAULT_SOURCE_KEY) value = idMap.get(value) ?? value;
          // A seeding marker whose source did not come along would only stop the built-in source from being re-added.
          if (r.key.startsWith("seeded:") && !adopted.has(r.key.slice("seeded:".length))) continue;
          await this.q(`INSERT INTO ${TABLES.settings} (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [r.key, value]);
          copied += 1;
        }
        notes.push(`copied ${copied} setting(s)`);
      } catch (err) {
        notes.push(`could not read the previous "${LEGACY_TABLES.settings}" table: ${errMsg(err)}`);
      }
    }
    const report: MigrationReport = { at: new Date().toISOString(), notes };
    await this.q(`INSERT INTO ${TABLES.settings} (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [MIGRATION_KEY, JSON.stringify(report)]);
    if (has.size) console.info(`[data-sources] Adopted the previous tables: ${notes.join("; ")}`);
  }

  async migration(): Promise<MigrationReport | null> {
    await this.ensureSchema();
    const { rows } = await this.q(`SELECT value FROM ${TABLES.settings} WHERE key = $1`, [MIGRATION_KEY]);
    const raw = (rows[0] as { value: string } | undefined)?.value;
    if (!raw) return null;
    const report = json<MigrationReport>(raw);
    return report && Array.isArray(report.notes) && report.notes.length ? report : null;
  }

  async list(): Promise<StoredDataSourceHeader[]> {
    await this.ensureSchema();
    const { rows } = await this.q(`SELECT id, name, manifest, updated_at FROM ${TABLES.sources} ORDER BY name`);
    return (rows as Row[]).map((r) => ({ id: r.id, name: r.name, manifest: json<DataSourceManifest>(r.manifest), updatedAt: iso(r.updated_at) }));
  }

  async get(id: string): Promise<StoredDataSource | null> {
    await this.ensureSchema();
    const { rows } = await this.q(`SELECT id, name, manifest, assets, products, updated_at FROM ${TABLES.sources} WHERE id = $1`, [id]);
    const r = rows[0] as Row | undefined;
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      manifest: json<DataSourceManifest>(r.manifest),
      assets: json<NormalizedAsset[]>(r.assets),
      products: json<NormalizedProduct[]>(r.products),
      updatedAt: iso(r.updated_at),
    };
  }

  async getVersion(id: string): Promise<string | null> {
    await this.ensureSchema();
    const { rows } = await this.q(`SELECT updated_at FROM ${TABLES.sources} WHERE id = $1`, [id]);
    const r = rows[0] as Pick<Row, "updated_at"> | undefined;
    return r ? iso(r.updated_at) : null;
  }

  async put(record: Omit<StoredDataSource, "updatedAt">): Promise<StoredDataSource> {
    await this.ensureSchema();
    const now = new Date();
    await this.q(
      `INSERT INTO ${TABLES.sources} (id, name, manifest, assets, products, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $6)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, manifest = EXCLUDED.manifest, assets = EXCLUDED.assets,
         products = EXCLUDED.products, updated_at = EXCLUDED.updated_at`,
      [record.id, record.name, JSON.stringify(record.manifest), JSON.stringify(record.assets), JSON.stringify(record.products), now],
    );
    return { ...record, updatedAt: now.toISOString() };
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureSchema();
    const { rows } = await this.q(`DELETE FROM ${TABLES.sources} WHERE id = $1 RETURNING id`, [id]);
    await this.q(`DELETE FROM ${TABLES.profiles} WHERE data_source_id = $1`, [id]);
    if (rows.length && (await this.getSetting(DEFAULT_SOURCE_KEY)) === id) await this.setSetting(DEFAULT_SOURCE_KEY, null);
    return rows.length > 0;
  }

  async getProfile(id: string): Promise<QuoteProfile | null> {
    await this.ensureSchema();
    const { rows } = await this.q(`SELECT profile FROM ${TABLES.profiles} WHERE data_source_id = $1`, [id]);
    const r = rows[0] as { profile: unknown } | undefined;
    return r ? json<QuoteProfile>(r.profile) : null;
  }

  async setProfile(id: string, profile: QuoteProfile | null): Promise<void> {
    await this.ensureSchema();
    if (profile === null) {
      await this.q(`DELETE FROM ${TABLES.profiles} WHERE data_source_id = $1`, [id]);
      return;
    }
    await this.q(
      `INSERT INTO ${TABLES.profiles} (data_source_id, profile, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (data_source_id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = now()`,
      [id, JSON.stringify(profile)],
    );
  }

  async getSetting(key: string): Promise<string | null> {
    await this.ensureSchema();
    const { rows } = await this.q(`SELECT value FROM ${TABLES.settings} WHERE key = $1`, [key]);
    return (rows[0] as { value: string } | undefined)?.value ?? null;
  }

  async setSetting(key: string, value: string | null): Promise<void> {
    await this.ensureSchema();
    if (value === null) {
      await this.q(`DELETE FROM ${TABLES.settings} WHERE key = $1`, [key]);
      return;
    }
    await this.q(
      `INSERT INTO ${TABLES.settings} (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value],
    );
  }
}
