/**
 * Branding comes from the active data source's Quote Profile:
 *  A. Cytek — Current keeps its Cytek-branded document (golden fixtures cover
 *     the exact text; here we assert the identity lines).
 *  B. A new source has no profile: generation is refused with a clear
 *     message until a profile is saved; then its own identity is used and
 *     nothing Cytek appears.
 *  C. Alternating sources never leaks branding either way.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import app from "../app.js";
import { DataSourceService, setDataSourceService } from "../data-sources/service.js";
import { MemoryDataSourceStore } from "../data-sources/store.js";
import { cytekSeed } from "../data-sources/cytek/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REV5 = readFileSync(path.join(here, "..", "data-sources", "cytek", "source", "cytek-quoting-tool-rev5.xlsx"));

let server: http.Server;
let baseUrl = "";
before(async () => {
  setDataSourceService(new DataSourceService(new MemoryDataSourceStore(), [cytekSeed]));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const quote = (dataSource: string, extra: object = {}) => ({
  dataSource,
  customerName: "Test Customer",
  serialNumber: "U1399",
  parts: [{ description: "Flow Cell Body", partNumber: "N0-00011", quantity: 1, unitPrice: 268.71 }],
  ...extra,
});

async function generate(payload: unknown) {
  const res = await fetch(`${baseUrl}/api/quotes/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.status !== 200) return { status: res.status, body: (await res.json()) as any, text: "", pages: 0 };
  const parsed = await pdfParse(Buffer.from(await res.arrayBuffer()));
  return { status: 200, body: null, text: parsed.text.replace(/\s+/g, " "), pages: parsed.numpages };
}

test("A. Cytek — Current produces the Cytek-branded document", async () => {
  const r = await generate(quote("cytek"));
  assert.equal(r.status, 200);
  assert.equal(r.pages, 4);
  assert.match(r.text, /Cytek Biosciences Inc\. \| Offices in Fremont, CA 94538\. 47215 Lakeview Blvd/);
  assert.match(r.text, /Phone: \(510\) 657-0102 \| Fax: \(510\) 657-0151 \| www\.cytekbio\.com \| email: technical\.support@cytekbio\.com/);
  assert.match(r.text, /-Cytek will confirm order receipt and estimated ship date\./);
  assert.match(r.text, /GENERAL TERMS AND CONDITIONS OF SALE/);
  assert.match(r.text, /Serial Number: U1399/);
});

test("B. a new source has no branding: generation is refused until its own profile is saved, then only its identity appears", async () => {
  const form = new FormData();
  form.append("name", "Test Company");
  form.append("file", new Blob([REV5]), "test-company.xlsx");
  assert.equal((await fetch(`${baseUrl}/api/data-sources`, { method: "POST", body: form })).status, 201);

  const refused = await generate(quote("test-company"));
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /Quote Profile for "Test Company" is incomplete/);
  assert.deepEqual(refused.body.missing, ["Company name", "Street address", "City, state and ZIP", "Phone", "Email"]);

  const put = await fetch(`${baseUrl}/api/data-sources/test-company/profile`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      companyName: "Evans Medical Test Co",
      shortName: "Evans Medical",
      address: { street: "100 Test Street", cityStateZip: "Austin, TX 78701" },
      contact: { phone: "(512) 555-0100", fax: "", website: "www.evansmedical.test", email: "quotes@evansmedical.test" },
      logo: null,
      quoteBullets: ["-Prices valid 30 days."],
      termsAndConditions: { title: "", subtitle: "", intro: "", sections: [] },
      pdfTheme: { tableHeaderBackground: "#dde6f0", textColor: "#1a2b3c", borderColor: "#1a2b3c" },
    }),
  });
  assert.equal(put.status, 200);
  assert.equal(((await put.json()) as any).complete, true);

  const r = await generate(quote("test-company", { serialNumber: "8470060146" }));
  assert.equal(r.status, 200);
  assert.equal(r.pages, 1, "no terms configured -> no terms pages");
  assert.match(r.text, /^\s*Evans Medical\b/, "short name is printed where the logo would be");
  assert.match(r.text, /Evans Medical Test Co \| Offices in Austin, TX 78701\. 100 Test Street/);
  assert.match(r.text, /Phone: \(512\) 555-0100 \| www\.evansmedical\.test \| email: quotes@evansmedical\.test/);
  assert.match(r.text, /-Prices valid 30 days\./);
  assert.match(r.text, /Serial Number: 8470060146/);
  assert.doesNotMatch(r.text, /cytek/i, "nothing Cytek in a Test Company document");
});

test("C. alternating sources never leaks branding", async () => {
  const a1 = await generate(quote("cytek"));
  const b = await generate(quote("test-company"));
  const a2 = await generate(quote("cytek"));
  for (const r of [a1, a2]) {
    assert.match(r.text, /Cytek Biosciences Inc\./);
    assert.doesNotMatch(r.text, /Evans Medical/);
    assert.equal(r.pages, 4);
  }
  assert.match(b.text, /Evans Medical Test Co/);
  assert.doesNotMatch(b.text, /cytek/i);
  assert.equal(b.pages, 1);
});

test("unknown data source is a 404, and omitting it uses the default source", async () => {
  assert.equal((await generate(quote("nope"))).status, 404);
  const r = await generate({ customerName: "X", serialNumber: "S", parts: [] });
  assert.equal(r.status, 200);
  assert.match(r.text, /Cytek Biosciences Inc\./);
});
