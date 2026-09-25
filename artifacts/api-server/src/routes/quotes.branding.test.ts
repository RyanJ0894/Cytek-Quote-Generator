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

const TEST_TERMS = {
  title: "TEST TERMS & CONDITIONS",
  subtitle: "(TEST PLACEHOLDER — NOT APPROVED LEGAL TERMS)",
  intro: "",
  sections: [
    { heading: "1. Payment Terms —", body: "Payment is due according to the terms stated on the applicable invoice." },
    { heading: "2. Quote Validity —", body: "This test quotation is valid for 30 days from the quote date." },
    { heading: "3. Shipping —", body: "Shipping and handling charges, when applicable, will be identified on the quotation or invoice." },
    { heading: "4. Acceptance —", body: "Acceptance of this quotation confirms the customer's authorization to proceed with the products or services described herein.\n\nSecond paragraph of the acceptance clause.\nWith a kept line break." },
  ],
};

test("D. terms belong to the profile: Collab World Medical gets its own Terms pages, Cytek keeps its own, and a workbook update leaves terms untouched", async () => {
  const svc = new DataSourceService(new MemoryDataSourceStore(), [cytekSeed]);
  setDataSourceService(svc);
  await svc.importFromWorkbook("Collab World Medical", { buffer: REV5, fileName: "collab.xlsx" });
  const profile = {
    companyName: "Collab World Medical LLC",
    shortName: "Collab World Medical",
    address: { street: "500 Collaboration Way", cityStateZip: "Denver, CO 80202" },
    contact: { phone: "(303) 555-0100", fax: "", website: "www.collabworld.test", email: "quotes@collabworld.test" },
    logo: null,
    quoteBullets: ["-All prices in USD"],
    termsAndConditions: TEST_TERMS,
    pdfTheme: { tableHeaderBackground: "#e8e8e8", textColor: "#000000", borderColor: "#000000" },
  };
  let put = await fetch(baseUrl + "/api/data-sources/collab-world-medical/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(profile) });
  assert.equal(put.status, 200);
  const listing = (await (await fetch(baseUrl + "/api/data-sources")).json()) as any;
  const collab = listing.dataSources.find((d: any) => d.id === "collab-world-medical");
  assert.equal(collab.quoteProfile.hasTerms, true);
  assert.equal(collab.quoteProfile.termsSectionCount, 4);
  assert.equal(listing.dataSources.find((d: any) => d.id === "cytek").quoteProfile.hasTerms, true);

  // Collab World quote: page 1 quote, page 2 its own TEST terms, nothing Cytek.
  const r = await generate(quote("collab-world-medical", { serialNumber: "8470060146", serviceType: "PM Service", servicePrice: 1500 }));
  assert.equal(r.status, 200);
  assert.equal(r.pages, 2, "quote page + one Terms page");
  assert.match(r.text, /Collab World Medical LLC \| Offices in Denver, CO 80202/);
  assert.match(r.text, /Serial Number: 8470060146/);
  assert.match(r.text, /TEST TERMS & CONDITIONS/);
  assert.match(r.text, /TEST PLACEHOLDER/);
  assert.match(r.text, /1\. Payment Terms — Payment is due according to the terms stated on the applicable invoice\./);
  assert.match(r.text, /4\. Acceptance — Acceptance of this quotation/);
  assert.match(r.text, /Second paragraph of the acceptance clause\./);
  assert.doesNotMatch(r.text, /cytek/i, "no Cytek branding or contractual language");
  assert.doesNotMatch(r.text, /GENERAL TERMS AND CONDITIONS OF SALE|Wells Fargo|flow cytometer/i);

  // Cytek: its own terms, nothing from Collab World.
  const c = await generate(quote("cytek"));
  assert.equal(c.pages, 4);
  assert.match(c.text, /GENERAL TERMS AND CONDITIONS OF SALE/);
  assert.match(c.text, /2\. PAYMENT TERMS: Terms are net 30 days/);
  assert.doesNotMatch(c.text, /Collab World|TEST TERMS/);

  // Replacing the workbook changes the catalog only; the terms stay exactly as saved.
  await svc.replaceWorkbook("collab-world-medical", { buffer: REV5, fileName: "collab-v2.xlsx" });
  const after = (await (await fetch(baseUrl + "/api/data-sources/collab-world-medical/profile")).json()) as any;
  assert.deepEqual(after.profile.termsAndConditions, TEST_TERMS);
  const r2 = await generate(quote("collab-world-medical", { serialNumber: "8470060146" }));
  assert.equal(r2.pages, 2);
  assert.match(r2.text, /TEST TERMS & CONDITIONS/);

  // Removing the terms: the document ends after the quote page, no blank page.
  put = await fetch(baseUrl + "/api/data-sources/collab-world-medical/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...profile, termsAndConditions: { title: "Unused title", subtitle: "", intro: "", sections: [] } }) });
  assert.equal(put.status, 200);
  const r3 = await generate(quote("collab-world-medical", { serialNumber: "8470060146" }));
  assert.equal(r3.pages, 1, "a title alone is not terms: no empty Terms page");
  assert.doesNotMatch(r3.text, /Unused title|TEST TERMS/);
  assert.equal((await (await fetch(baseUrl + "/api/data-sources")).json() as any).dataSources.find((d: any) => d.id === "collab-world-medical").quoteProfile.hasTerms, false);

  setDataSourceService(new DataSourceService(new MemoryDataSourceStore(), [cytekSeed]));
});

test("unknown data source is a 404, and omitting it uses the default source", async () => {
  assert.equal((await generate(quote("nope"))).status, 404);
  const r = await generate({ customerName: "X", serialNumber: "S", parts: [] });
  assert.equal(r.status, 200);
  assert.match(r.text, /Cytek Biosciences Inc\./);
});
