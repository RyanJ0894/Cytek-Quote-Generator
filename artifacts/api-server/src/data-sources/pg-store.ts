import { DEFAULT_SOURCE_KEY, type DataSourceStore, type StoredDataSourceHeader, type StoreKind } from "./store.js";
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

/** jsonb values come back parsed by pg/PGlite; tolerate a string just in case. */
function json<T>(v: unknown): T {
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
}

/**
 * Postgres-backed store. Tables are created on first use with
 * CREATE TABLE IF NOT EXISTS (two small tables, see
 * lib/db/src/schema/data-sources.ts for the reference schema). Whole
 * sources are stored as jsonb and indexed in memory after loading.
 */
export class PgDataSourceStore implements DataSourceStore {
  readonly kind: StoreKind = "postgres";
  readonly persistent = true;
  private ready: Promise<void> | null = null;

  constructor(private readonly client: SqlClient) {}

  private ensureSchema(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await this.client.query(`CREATE TABLE IF NOT EXISTS data_sources (
          id text PRIMARY KEY,
          name text NOT NULL,
          manifest jsonb NOT NULL,
          assets jsonb NOT NULL,
          products jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`);
        await this.client.query(`CREATE TABLE IF NOT EXISTS app_settings (
          key text PRIMARY KEY,
          value text NOT NULL
        )`);
        await this.client.query(`CREATE TABLE IF NOT EXISTS quote_profiles (
          data_source_id text PRIMARY KEY,
          profile jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )`);
      })().catch((err) => {
        this.ready = null;
        throw err;
      });
    }
    return this.ready;
  }

  async list(): Promise<StoredDataSourceHeader[]> {
    await this.ensureSchema();
    const { rows } = await this.client.query(`SELECT id, name, manifest, updated_at FROM data_sources ORDER BY name`);
    return (rows as Row[]).map((r) => ({ id: r.id, name: r.name, manifest: json<DataSourceManifest>(r.manifest), updatedAt: iso(r.updated_at) }));
  }

  async get(id: string): Promise<StoredDataSource | null> {
    await this.ensureSchema();
    const { rows } = await this.client.query(`SELECT id, name, manifest, assets, products, updated_at FROM data_sources WHERE id = $1`, [id]);
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
    const { rows } = await this.client.query(`SELECT updated_at FROM data_sources WHERE id = $1`, [id]);
    const r = rows[0] as Pick<Row, "updated_at"> | undefined;
    return r ? iso(r.updated_at) : null;
  }

  async put(record: Omit<StoredDataSource, "updatedAt">): Promise<StoredDataSource> {
    await this.ensureSchema();
    const now = new Date();
    await this.client.query(
      `INSERT INTO data_sources (id, name, manifest, assets, products, created_at, updated_at)
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
    const { rows } = await this.client.query(`DELETE FROM data_sources WHERE id = $1 RETURNING id`, [id]);
    await this.client.query(`DELETE FROM quote_profiles WHERE data_source_id = $1`, [id]);
    if (rows.length && (await this.getSetting(DEFAULT_SOURCE_KEY)) === id) await this.setSetting(DEFAULT_SOURCE_KEY, null);
    return rows.length > 0;
  }

  async getProfile(id: string): Promise<QuoteProfile | null> {
    await this.ensureSchema();
    const { rows } = await this.client.query(`SELECT profile FROM quote_profiles WHERE data_source_id = $1`, [id]);
    const r = rows[0] as { profile: unknown } | undefined;
    return r ? json<QuoteProfile>(r.profile) : null;
  }

  async setProfile(id: string, profile: QuoteProfile | null): Promise<void> {
    await this.ensureSchema();
    if (profile === null) {
      await this.client.query(`DELETE FROM quote_profiles WHERE data_source_id = $1`, [id]);
      return;
    }
    await this.client.query(
      `INSERT INTO quote_profiles (data_source_id, profile, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (data_source_id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = now()`,
      [id, JSON.stringify(profile)],
    );
  }

  async getSetting(key: string): Promise<string | null> {
    await this.ensureSchema();
    const { rows } = await this.client.query(`SELECT value FROM app_settings WHERE key = $1`, [key]);
    return (rows[0] as { value: string } | undefined)?.value ?? null;
  }

  async setSetting(key: string, value: string | null): Promise<void> {
    await this.ensureSchema();
    if (value === null) {
      await this.client.query(`DELETE FROM app_settings WHERE key = $1`, [key]);
      return;
    }
    await this.client.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value],
    );
  }
}
