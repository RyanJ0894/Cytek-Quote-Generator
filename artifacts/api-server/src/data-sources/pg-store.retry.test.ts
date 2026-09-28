/**
 * The Postgres store survives a dropped connection: the first statement after
 * a serverless thaw may fail with a connection-level error, and one retry on a
 * fresh connection must succeed. Statement errors are not retried.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PgDataSourceStore, isConnectionError, type SqlClient } from "./pg-store.js";

class FlakyClient implements SqlClient {
  calls = 0;
  failNext: Error | null = null;
  constructor(private readonly db: PGlite) {}
  async query(text: string, params?: unknown[]) {
    this.calls += 1;
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    return this.db.query(text, params as any[]);
  }
}

test("isConnectionError recognises socket/session failures only", () => {
  assert.equal(isConnectionError(new Error("Connection terminated unexpectedly")), true);
  assert.equal(isConnectionError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })), true);
  assert.equal(isConnectionError(Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" })), true);
  assert.equal(isConnectionError(Object.assign(new Error("relation \"nope\" does not exist"), { code: "42P01" })), false);
  assert.equal(isConnectionError(new Error("syntax error at or near")), false);
});

test("a dropped connection is retried once; a bad statement is not", async () => {
  const db = new PGlite();
  const client = new FlakyClient(db);
  const store = new PgDataSourceStore(client);
  assert.deepEqual(await store.list(), []);
  const baseline = client.calls;

  client.failNext = new Error("Connection terminated unexpectedly");
  assert.deepEqual(await store.list(), [], "first statement after a thaw fails, the retry succeeds");
  assert.equal(client.calls, baseline + 2, "exactly one retry");

  client.failNext = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
  assert.equal(await store.getSetting("x"), null);

  client.failNext = Object.assign(new Error("permission denied"), { code: "42501" });
  await assert.rejects(store.list(), /permission denied/, "statement errors surface immediately");
  await db.close();
});
