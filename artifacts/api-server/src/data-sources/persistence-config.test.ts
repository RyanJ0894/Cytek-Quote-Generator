/**
 * Which environment variables select the Postgres store, and how the pool is
 * configured for hosted (TLS) vs local databases.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { databaseUrlFromEnv, pgPoolConfig } from "./service.js";

const pick = (env: NodeJS.ProcessEnv) => {
  const r = databaseUrlFromEnv(env);
  return r && { name: r.name, url: r.url };
};

test("databaseUrlFromEnv prefers DATABASE_URL, then the variables Vercel integrations set", () => {
  assert.equal(pick({}), null);
  assert.deepEqual(pick({ POSTGRES_URL: "postgres://a" }), { name: "POSTGRES_URL", url: "postgres://a" });
  assert.deepEqual(pick({ POSTGRES_URL: "postgres://a", DATABASE_URL: " postgresql://b " }), { name: "DATABASE_URL", url: "postgresql://b" });
  assert.deepEqual(pick({ DATABASE_URL: "", DATABASE_URL_UNPOOLED: "postgres://c" }), { name: "DATABASE_URL_UNPOOLED", url: "postgres://c" });
  assert.equal(pick({ DATA_SOURCES_DIR: "/tmp/x" }), null, "the file store's variable never selects Postgres");
  assert.equal(pick({ DATABASE_URL: "mysql://nope" }), null, "only postgres:// connection strings count");
});

test("databaseUrlFromEnv accepts integration prefixes and PG* component variables", () => {
  assert.deepEqual(pick({ STORAGE_DATABASE_URL: "postgres://p" }), { name: "STORAGE_DATABASE_URL", url: "postgres://p" });
  assert.deepEqual(pick({ NEON_POSTGRES_URL_NON_POOLING: "postgres://np", NEON_POSTGRES_URL: "postgres://pooled" }), { name: "NEON_POSTGRES_URL", url: "postgres://pooled" }, "pooled variant wins over non-pooling");
  assert.deepEqual(pick({ STORAGE_POSTGRES_PRISMA_URL: "postgres://prisma" }), { name: "STORAGE_POSTGRES_PRISMA_URL", url: "postgres://prisma" });
  assert.deepEqual(pick({ PGHOST: "ep.neon.tech", PGUSER: "u", PGPASSWORD: "p", PGDATABASE: "db" }), { name: "PGHOST/PGUSER/PGPASSWORD/PGDATABASE", url: null });
  assert.equal(pick({ PGHOST: "ep.neon.tech", PGUSER: "u" }), null, "incomplete PG* set is not enough");
  const r = databaseUrlFromEnv({ POSTGRES_HOST: "h", NEON_PROJECT_ID: "x", PATH: "/bin" });
  assert.equal(r, null);
});

test("pgPoolConfig: TLS for hosted databases unless the URL already says, none for localhost", () => {
  const neon = pgPoolConfig("postgresql://user:pw@ep-x.us-east-1.aws.neon.tech/neondb?sslmode=require");
  assert.equal(neon.ssl, undefined, "sslmode in the URL is left to pg");
  const bare = pgPoolConfig("postgresql://user:pw@db.example.com:5432/app");
  assert.deepEqual(bare.ssl, { rejectUnauthorized: true });
  const local = pgPoolConfig("postgresql://user:pw@localhost:5432/app");
  assert.equal(local.ssl, undefined);
  assert.equal(local.max, 3, "small pools: many serverless instances share one database");
  assert.equal(pgPoolConfig("not a url").connectionString, "not a url");
  const parts = pgPoolConfig(null, { PGHOST: "ep.neon.tech" });
  assert.equal(parts.connectionString, undefined);
  assert.deepEqual(parts.ssl, { rejectUnauthorized: true });
});
