/**
 * Which environment variables select the Postgres store, and how the pool is
 * configured for hosted (TLS) vs local databases.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { databaseUrlFromEnv, pgPoolConfig } from "./service.js";

test("databaseUrlFromEnv prefers DATABASE_URL, then the variables Vercel integrations set", () => {
  assert.equal(databaseUrlFromEnv({}), null);
  assert.deepEqual(databaseUrlFromEnv({ POSTGRES_URL: "postgres://a" }), { name: "POSTGRES_URL", url: "postgres://a" });
  assert.deepEqual(databaseUrlFromEnv({ POSTGRES_URL: "postgres://a", DATABASE_URL: " postgres://b " }), { name: "DATABASE_URL", url: "postgres://b" });
  assert.deepEqual(databaseUrlFromEnv({ DATABASE_URL: "", DATABASE_URL_UNPOOLED: "postgres://c" }), { name: "DATABASE_URL_UNPOOLED", url: "postgres://c" });
  assert.equal(databaseUrlFromEnv({ DATA_SOURCES_DIR: "/tmp/x" }), null, "the file store's variable never selects Postgres");
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
});
