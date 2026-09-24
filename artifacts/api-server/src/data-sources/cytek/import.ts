/**
 * One-time import CLI for the built-in Cytek data source.
 *
 *   pnpm --filter @workspace/api-server run import:cytek
 *
 * Reads the source workbook(s) in ./source, runs the workbook importer and
 * writes the normalized assets.json / products.json / manifest.json next to
 * this file. Those generated files are compiled into the server as the SEED
 * data source, saved into the store on first start. Afterwards the user
 * maintains it (update/replace/delete) from the app's Data Sources page, so
 * re-running this only affects fresh installations.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import xlsx from "xlsx";
import { importWorkbook } from "../workbook-importer.js";

export const CYTEK_DATA_SOURCE_ID = "cytek";
export const CYTEK_DATA_SOURCE_NAME = "Cytek — Current";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = path.join(here, "source");

const PRIMARY = { fileName: "cytek-quoting-tool-rev6.xlsx", label: "Cytek Quoting Tool - Rev6.xlsx" };
const SUPPLEMENT = { fileName: "cytek-quoting-tool-rev5.xlsx", label: "Cytek Quoting Tool - Rev5.xlsx" };

function loadWorkbook(fileName: string, label: string) {
  const full = path.join(SOURCE_DIR, fileName);
  if (!existsSync(full)) throw new Error(`Source workbook not found: ${full}`);
  const buf = readFileSync(full);
  return {
    workbook: xlsx.read(buf, { type: "buffer" }),
    file: { fileName, label, sha256: createHash("sha256").update(buf).digest("hex") },
  };
}

const primary = loadWorkbook(PRIMARY.fileName, PRIMARY.label);
const supplement = existsSync(path.join(SOURCE_DIR, SUPPLEMENT.fileName))
  ? loadWorkbook(SUPPLEMENT.fileName, SUPPLEMENT.label)
  : undefined;

const result = importWorkbook({ id: CYTEK_DATA_SOURCE_ID, name: CYTEK_DATA_SOURCE_NAME, primary, supplement });

// Empty-string fields are omitted on disk (createStaticDataSource restores
// them), which keeps the generated files and the server bundle small.
const compact = (rows: object[]) =>
  JSON.stringify(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== ""))));
writeFileSync(path.join(here, "assets.json"), compact(result.assets));
writeFileSync(path.join(here, "products.json"), compact(result.products));
writeFileSync(path.join(here, "manifest.json"), JSON.stringify(result.manifest, null, 2) + "\n");

const m = result.manifest;
console.log(`Imported data source "${m.name}" (${m.id}) at ${m.importedAt}`);
for (const s of m.sources) console.log(`  ${s.role.padEnd(10)} ${s.label}  sha256=${s.sha256.slice(0, 12)}…  sheets: ${s.sheetsUsed.join(", ")}`);
console.log(`  assets: ${m.counts.assets} (enriched from supplement: ${m.counts.assetsEnrichedFromSupplement}, of which account name changed: ${m.counts.assetsEnrichedWithDifferentAccountName}; facility defaulted to account: ${m.counts.assetsFacilityDefaultedToAccount})`);
console.log(`  products: ${m.counts.products} (priced: ${m.counts.pricedProducts}, unpriced: ${m.counts.unpricedProducts}, services: ${m.counts.services})`);
console.log("  rejected:");
for (const [reason, r] of Object.entries(m.rejected)) console.log(`    ${r.count.toString().padStart(6)}  ${reason}  e.g. ${r.samples.slice(0, 3).join(", ")}`);
