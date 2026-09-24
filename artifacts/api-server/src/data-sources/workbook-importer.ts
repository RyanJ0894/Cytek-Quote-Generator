/**
 * Workbook importer: transforms a "Cytek Quoting Tool" style workbook into
 * the normalized Data Source records (see ./types.ts).
 *
 * This is the ONLY place that knows the workbook's sheet names and column
 * headers. It reads the underlying data sheets directly (never the
 * workbook's VLOOKUP formulas, several of which are #REF! in Rev6) and
 * locates columns by header text, so column re-ordering in a future
 * revision cannot silently shift fields.
 *
 * Supported layout ("Cytek workbook format"):
 *  - sheet "Asset Data": one row per instrument. Either the Rev6 export
 *    headers ("Serial Number", "Account Name", ...) or the Rev5 headers
 *    ("Asset Name", "Account: Account Name", "shortened facility name",
 *    "Street", ...) are recognised; a workbook may carry both sets.
 *  - sheet "Pricing Data": "Display Name", "Unit Price", "Part Number",
 *    optionally "Sale Unit" and "Item Internal ID".
 *
 * An optional supplement workbook fills in asset fields the primary one
 * leaves blank (used for the built-in Cytek source, whose Rev6 export dropped
 * the address/facility/contact columns still present in Rev5). Serials only
 * in the supplement are not imported: the primary workbook defines which
 * assets exist.
 */
import xlsx from "xlsx";
import type {
  DataSourceManifest,
  NormalizedAsset,
  NormalizedProduct,
  RejectedSummary,
  SourceFileInfo,
} from "./types.js";
import { normalizeSerial } from "./static-source.js";

export const ASSET_SHEET = "Asset Data";
export const PRICING_SHEET = "Pricing Data";

type AssetField = Exclude<keyof NormalizedAsset, "assetName">;

/** Normalized asset field -> accepted column headers, in order of preference. */
const ASSET_HEADERS: Record<AssetField, string[]> = {
  serialNumber: ["Serial Number", "Asset Name"],
  accountName: ["Account Name", "Account: Account Name"],
  facilityName: ["shortened facility name", "Facility Code"],
  serviceTerritory: ["Service Territory: Name", "Service Territory"],
  primaryTechnician: ["Primary Service Technician", "Primary FAS"],
  contractNumber: ["Synced Contract: Contract Number", "Contract Number"],
  contractType: ["Synced Contract: Contract Type", "Contract Type"],
  contractEndDate: ["Synced Contract: Contract End Date", "Contract End Date"],
  productName: ["Product: Product Name", "Product Name"],
  contactName: ["Contact: Full Name", "Contact Name"],
  contactEmail: ["Contact: Email", "Contact Email"],
  street: ["Street"],
  city: ["City"],
  stateZip: ["State and Zip code", "State and Zip", "State/Zip"],
  region: ["Region"],
  country: ["Country"],
  assetStatus: ["Status"],
  installDate: ["Install Date"],
};

/** Fields an Asset Data sheet must have to be usable at all. */
const REQUIRED_ASSET_FIELDS: AssetField[] = ["serialNumber", "accountName"];

const PRICING_HEADERS = {
  partName: ["Display Name", "Product Name", "Description"],
  unit: ["Sale Unit", "Unit"],
  listPrice: ["Unit Price", "List Price", "Price"],
  partNumber: ["Part Number", "Product Number", "Item Number"],
  itemInternalId: ["Item Internal ID"],
} as const;
type PricingField = keyof typeof PRICING_HEADERS;
const REQUIRED_PRICING_FIELDS: PricingField[] = ["partName", "listPrice", "partNumber"];

/** Sale units that identify a service/contract SKU rather than a physical part. */
const SERVICE_UNITS = new Set(["year", "2 years", "3 years", "hour"]);

const REJECT_SAMPLE_LIMIT = 10;

/** Rows whose only name is an adjustment label (no display name in the source). */
const ADJUSTMENT_NAME = /discount|surcharge|offset|allowance|trade-in/i;

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = parseFloat(str(v).replace(/[,$]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Money values are kept to cents; the source occasionally carries 3+ decimals. */
function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Excel date serial / Date / date-ish string -> "YYYY-MM-DD" or "". */
export function toIsoDate(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = xlsx.SSF.parse_date_code(v);
    if (!d) return "";
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = str(v);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10);
}

export interface SheetRead<F extends string> {
  rows: Array<Record<F, unknown>>;
  /** field -> header actually used */
  headersUsed: Partial<Record<F, string>>;
}

/**
 * Reads a sheet into objects keyed by normalized field name. For each field
 * the first accepted header present in the sheet is used (matched trimmed and
 * case-insensitively). Throws a descriptive error when a required field has
 * no matching column.
 */
export function readSheet<F extends string>(
  wb: xlsx.WorkBook,
  sheetName: string,
  headers: Record<F, readonly string[]>,
  required: readonly F[],
  fileLabel: string,
): SheetRead<F> {
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new Error(`${fileLabel}: sheet "${sheetName}" not found (sheets: ${wb.SheetNames.join(", ")})`);
  }
  const grid = xlsx.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
  const headerRow = (grid[0] ?? []).map((h) => str(h));
  const index = new Map<string, number>();
  headerRow.forEach((h, i) => {
    if (h && !index.has(h.toLowerCase())) index.set(h.toLowerCase(), i);
  });

  const columns: Partial<Record<F, number>> = {};
  const headersUsed: Partial<Record<F, string>> = {};
  for (const field of Object.keys(headers) as F[]) {
    for (const h of headers[field]) {
      const col = index.get(h.toLowerCase());
      if (col !== undefined) {
        columns[field] = col;
        headersUsed[field] = headerRow[col];
        break;
      }
    }
  }
  const missing = required.filter((f) => columns[f] === undefined);
  if (missing.length) {
    throw new Error(
      `${fileLabel}: sheet "${sheetName}" is missing expected column(s): ` +
        missing.map((f) => headers[f].map((h) => `"${h}"`).join(" or ")).join(", ") +
        `. Found: ${headerRow.filter(Boolean).join(" | ")}`,
    );
  }

  const rows = grid.slice(1).map((cells) => {
    const row = {} as Record<F, unknown>;
    for (const field of Object.keys(headers) as F[]) {
      const col = columns[field];
      row[field] = col === undefined ? "" : (cells[col] ?? "");
    }
    return row;
  });
  return { rows, headersUsed };
}

class Rejections {
  private readonly buckets = new Map<string, { count: number; samples: string[] }>();
  add(reason: string, sample: string) {
    const b = this.buckets.get(reason) ?? { count: 0, samples: [] };
    b.count += 1;
    if (b.samples.length < REJECT_SAMPLE_LIMIT) b.samples.push(sample);
    this.buckets.set(reason, b);
  }
  toJSON(): Record<string, RejectedSummary> {
    const out: Record<string, RejectedSummary> = {};
    for (const [k, v] of this.buckets) out[k] = { count: v.count, samples: v.samples };
    return out;
  }
}

export interface WorkbookInput {
  workbook: xlsx.WorkBook;
  file: Omit<SourceFileInfo, "role" | "sheetsUsed">;
}

export interface WorkbookImportInput {
  id: string;
  name: string;
  primary: WorkbookInput;
  supplement?: WorkbookInput;
  /** Injectable for deterministic tests. */
  now?: Date;
}

export interface WorkbookImportResult {
  assets: NormalizedAsset[];
  products: NormalizedProduct[];
  manifest: DataSourceManifest;
}

const EMPTY_ASSET: NormalizedAsset = {
  serialNumber: "", assetName: "", accountName: "", facilityName: "", serviceTerritory: "",
  primaryTechnician: "", contractNumber: "", contractType: "", contractEndDate: "", productName: "",
  contactName: "", contactEmail: "", street: "", city: "", stateZip: "", region: "", country: "",
  assetStatus: "", installDate: "",
};
const DATE_FIELDS = new Set<AssetField>(["contractEndDate", "installDate"]);

function assetFromRow(row: Record<AssetField, unknown>): NormalizedAsset {
  const a: NormalizedAsset = { ...EMPTY_ASSET };
  for (const f of Object.keys(ASSET_HEADERS) as AssetField[]) {
    a[f] = DATE_FIELDS.has(f) ? toIsoDate(row[f]) : str(row[f]);
  }
  a.assetName = a.serialNumber;
  return a;
}

export function importWorkbook(input: WorkbookImportInput): WorkbookImportResult {
  const rejected = new Rejections();
  const primaryLabel = input.primary.file.label;
  const mappings: Record<string, string> = {};

  // ── Assets (primary) ───────────────────────────────────────────────
  const primaryAssets = readSheet(input.primary.workbook, ASSET_SHEET, ASSET_HEADERS, REQUIRED_ASSET_FIELDS, primaryLabel);
  for (const [field, header] of Object.entries(primaryAssets.headersUsed)) {
    mappings[field] = `primary ${ASSET_SHEET}!${header}`;
  }

  const assets: NormalizedAsset[] = [];
  const byKey = new Map<string, NormalizedAsset>();
  for (const row of primaryAssets.rows) {
    const a = assetFromRow(row);
    if (!a.serialNumber) {
      if (a.accountName || a.productName) rejected.add("asset: blank serial number", a.accountName || a.productName);
      continue;
    }
    const key = normalizeSerial(a.serialNumber);
    if (byKey.has(key)) {
      rejected.add("asset: duplicate serial number (first occurrence kept)", a.serialNumber);
      continue;
    }
    byKey.set(key, a);
    assets.push(a);
  }

  // ── Assets (supplement: fills fields the primary left blank) ───────
  let enriched = 0;
  let enrichedDifferentAccount = 0;
  const supplementSheets: string[] = [];
  if (input.supplement) {
    const sup = readSheet(input.supplement.workbook, ASSET_SHEET, ASSET_HEADERS, REQUIRED_ASSET_FIELDS, input.supplement.file.label);
    supplementSheets.push(ASSET_SHEET);
    const filledFromSupplement = new Set<AssetField>();
    for (const row of sup.rows) {
      const s = assetFromRow(row);
      if (!s.serialNumber) continue;
      const target = byKey.get(normalizeSerial(s.serialNumber));
      if (!target) {
        rejected.add("asset: only in supplement (not in primary), skipped", s.serialNumber);
        continue;
      }
      let touched = false;
      for (const f of Object.keys(ASSET_HEADERS) as AssetField[]) {
        if (f === "serialNumber" || f === "accountName" || f === "assetStatus") continue;
        if (!target[f] && s[f]) {
          target[f] = s[f];
          filledFromSupplement.add(f);
          touched = true;
        }
      }
      if (touched) {
        enriched += 1;
        if (s.accountName.toLowerCase() !== target.accountName.toLowerCase()) enrichedDifferentAccount += 1;
      }
    }
    for (const f of filledFromSupplement) {
      const header = sup.headersUsed[f];
      mappings[f] = mappings[f]
        ? `${mappings[f]}; else supplement ${ASSET_SHEET}!${header}`
        : `supplement ${ASSET_SHEET}!${header}`;
    }
  }

  let facilityDefaulted = 0;
  for (const a of assets) {
    if (!a.facilityName) {
      a.facilityName = a.accountName;
      facilityDefaulted += 1;
    }
  }
  mappings["assetName"] = "= serialNumber";
  mappings["facilityName"] = (mappings["facilityName"] ? `${mappings["facilityName"]}; ` : "") + "falls back to accountName";
  mappings["contractStatus"] = "derived at lookup: Activated if contractEndDate >= today, Expired if past, blank if none";

  // ── Products (primary) ─────────────────────────────────────────────
  const pricing = readSheet(input.primary.workbook, PRICING_SHEET, PRICING_HEADERS, REQUIRED_PRICING_FIELDS, primaryLabel);
  const products: NormalizedProduct[] = [];
  for (const r of pricing.rows) {
    const displayName = str(r.partName);
    const partNumber = str(r.partNumber);
    const partName = displayName || partNumber;
    if (!partName) {
      if (num(r.listPrice) !== null) rejected.add("product: blank name and part number", String(r.listPrice));
      continue;
    }
    const price = num(r.listPrice);
    if (price !== null && price < 0) {
      rejected.add("product: negative price (discount/adjustment item, not quotable)", partName);
      continue;
    }
    if (!displayName && ADJUSTMENT_NAME.test(partName)) {
      rejected.add("product: pricing adjustment item (discount/surcharge), not quotable", partName);
      continue;
    }
    const listPrice = price === null ? 0 : roundMoney(price);
    const unit = str(r.unit);
    const hasInternalId = str(r.itemInternalId) !== "";
    // Service SKUs are sold per year/hour, or are the few ad-hoc priced rows
    // with no internal item id (e.g. "On-Site Support (2 days)"). Unpriced
    // rows without an id are usually placeholders, so they stay "Parts".
    const isService = SERVICE_UNITS.has(unit.toLowerCase()) || (!hasInternalId && listPrice > 0);
    products.push({
      partName,
      partNumber,
      listPrice,
      netPrice: listPrice,
      category: isService ? "Service" : "Parts",
      unit,
      priced: listPrice > 0,
    });
  }
  const productMappings: Record<string, string> = {};
  for (const [field, header] of Object.entries(pricing.headersUsed)) {
    productMappings[field] = `primary ${PRICING_SHEET}!${header}`;
  }
  productMappings["partName"] = `${productMappings["partName"]}; falls back to partNumber when blank`;
  productMappings["listPrice"] = `${productMappings["listPrice"]} (rounded to cents; 0 with priced=false when blank/zero)`;
  productMappings["netPrice"] = "= listPrice (the workbook has no customer net price; 'Last Purchase Price' is internal cost and is not imported)";
  productMappings["category"] = `Service if ${pricing.headersUsed.unit ?? "Sale Unit"} is Year/2 Years/3 Years/Hour, or the row is priced but has no ${pricing.headersUsed.itemInternalId ?? "Item Internal ID"}; otherwise Parts`;

  const unpriced = products.filter((p) => !p.priced).length;
  const manifest: DataSourceManifest = {
    id: input.id,
    name: input.name,
    importedAt: (input.now ?? new Date()).toISOString(),
    sources: [
      { role: "primary", ...input.primary.file, sheetsUsed: [ASSET_SHEET, PRICING_SHEET] },
      ...(input.supplement ? [{ role: "supplement" as const, ...input.supplement.file, sheetsUsed: supplementSheets }] : []),
    ],
    counts: {
      assets: assets.length,
      products: products.length,
      pricedProducts: products.length - unpriced,
      unpricedProducts: unpriced,
      services: products.filter((p) => p.category === "Service").length,
      assetsEnrichedFromSupplement: enriched,
      assetsEnrichedWithDifferentAccountName: enrichedDifferentAccount,
      assetsFacilityDefaultedToAccount: facilityDefaulted,
    },
    rejected: rejected.toJSON(),
    fieldMappings: { assets: mappings, products: productMappings },
    notes: [
      "Underlying data sheets are read directly; the workbook's FSE Input VLOOKUP formulas are not used.",
      "Products without a usable list price are imported with priced=false so they remain searchable; the form asks for a price when one is selected.",
      ...(input.supplement
        ? [
            "Fields blank in the primary workbook were filled from the supplement for serials present in the primary; serials only in the supplement were not imported.",
            "Where the account name differs between primary and supplement, carried-over address/contact may be out of date; all populated fields remain editable in the form.",
          ]
        : []),
    ],
  };

  return { assets, products, manifest };
}
