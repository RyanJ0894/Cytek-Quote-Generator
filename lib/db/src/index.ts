import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export type Db = ReturnType<typeof createDb>;

/**
 * Creates a Drizzle client for the given Postgres connection string. Nothing
 * connects at import time so the API server can run without a database (it
 * then falls back to non-persistent data source storage).
 */
export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}

export * from "./schema";
