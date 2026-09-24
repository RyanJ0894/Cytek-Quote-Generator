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
  ProductCategory,
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

/**
 * Normalized asset field -> accepted column headers, in order of preference.
 * Headers are matched after normalizing (lower-case, punctuation collapsed to
 * spaces), so "Serial #", "serial_number" and "Serial Number" all match. An
 * alias starting with "~" matches any header that *contains* that text and
 * is tried only after every exact alias has failed.
 */
const ASSET_HEADERS: Record<AssetField, string[]> = {
  serialNumber: ["Serial Number", "Serial No", "Serial No.", "Serial #", "Serial", "S/N", "SN", "Instrument Serial Number", "Asset Serial Number", "~serial", "Asset Name"],
  accountName: ["Account Name", "Account: Account Name", "Customer Name", "Customer", "Client Name", "Client", "Company Name", "Company", "Account", "Organization"],
  facilityName: ["shortened facility name", "Facility Code", "Facility Name", "Facility", "Site Name", "Site", "Location Name", "Location", "Department"],
  serviceTerritory: ["Service Territory: Name", "Service Territory", "Territory", "Service Region"],
  primaryTechnician: ["Primary Service Technician", "Primary FAS", "Technician", "Service Technician", "FSE", "Engineer"],
  contractNumber: ["Synced Contract: Contract Number", "Contract Number", "Contract No", "Contract #", "Agreement Number", "Agreement #"],
  contractType: ["Synced Contract: Contract Type", "Contract Type", "Contract", "Coverage Type", "Coverage", "Service Level", "Service Plan", "Agreement Type", "Warranty Type", "Plan"],
  contractEndDate: ["Synced Contract: Contract End Date", "Contract End Date", "Contract End", "Coverage End Date", "Contract Expiration", "Expiration Date", "Expires", "Warranty End Date", "End Date"],
  productName: ["Product: Product Name", "Product Name", "Product", "Model", "Model Name", "Instrument Model", "Instrument Name", "Instrument", "Equipment Name", "Equipment", "Asset Model"],
  contactName: ["Contact: Full Name", "Contact Name", "Contact", "Primary Contact", "Contact Person", "Customer Contact"],
  contactEmail: ["Contact: Email", "Contact Email", "Contact E-mail", "Email", "E-mail"],
  street: ["Street", "Street Address", "Address", "Address 1", "Address Line 1", "Installed Address", "Site Address", "Ship To Address"],
  city: ["City", "Town"],
  stateZip: ["State and Zip code", "State and Zip", "State/Zip", "State Zip", "State, Zip"],
  region: ["Region"],
  country: ["Country"],
  assetStatus: ["Status", "Asset Status", "Instrument Status", "Equipment Status"],
  installDate: ["Install Date", "Installation Date", "Installed Date", "Installed", "Install"],
};

/**
 * Extra asset columns that feed a normalized field without being one: a
 * separate State + ZIP pair becomes `stateZip`. All optional.
 */
const ASSET_EXTRA_HEADERS = {
  state: ["State", "State/Province", "Province"],
  zip: ["Zip", "ZIP Code", "Zip Code", "Postal Code", "Postcode"],
} as const;
type AssetExtraField = keyof typeof ASSET_EXTRA_HEADERS;

/** Fields an Asset Data sheet must have to be usable at all. */
const REQUIRED_ASSET_FIELDS: AssetField[] = ["serialNumber", "accountName"];

const PRICING_HEADERS = {
  partName: ["Display Name", "Product Name", "Description", "Item Name", "Item Description", "Item", "Name", "Product"],
  unit: ["Sale Unit", "Unit", "UOM", "Unit of Measure", "Sales Unit", "Billing Unit"],
  listPrice: ["Unit Price", "List Price", "Price", "MSRP", "Sell Price", "Sale Price", "Rate"],
  partNumber: ["Part Number", "Product Number", "Item Number", "Part No", "Part #", "SKU", "Item Code", "Product Code", "Catalog Number", "Model Number", "Code"],
  itemInternalId: ["Item Internal ID", "Internal ID", "Item ID"],
  /** Optional explicit classification; honored before any heuristic. */
  category: ["Category", "Item Category", "Product Category", "Type", "Item Type", "Product Type", "Record Type", "Line Type", "Class", "Kind"],
} as const;
type PricingField = keyof typeof PRICING_HEADERS;
const REQUIRED_PRICING_FIELDS: PricingField[] = ["partName", "listPrice"];

/**
 * Sale units that identify a service or contract SKU (sold per period of
 * time or per visit) rather than a physical item.
 */
const SERVICE_UNITS = new Set([
  "year", "years", "2 years", "3 years", "yr", "annual", "per year",
  "month", "months", "per month",
  "week", "weeks",
  "day", "days", "per day",
  "hour", "hours", "hr", "hrs", "per hour",
  "visit", "visits", "per visit",
]);

/** Explicit category cell values (a "Category"/"Type" column) -> normalized category. */
function categoryFromLabel(label: string): ProductCategory | null {
  const l = label.trim().toLowerCase();
  if (!l) return null;
  if (/contract|agreement|warranty|coverage|subscription|plan|service|labor|labour|support|training|install|calibrat|maint|repair|visit|travel/.test(l)) return "Service";
  if (/instrument|system|equipment|analy[sz]er|cytometer|machine|capital|hardware|unit/.test(l)) return "Instrument";
  if (/part|component|consumable|accessor|spare|kit|reagent|supply|supplies|material|product|item|goods/.test(l)) return "Parts";
  return null;
}

/** Name heuristics, used only when a workbook carries no structural category signal. */
const SERVICE_NAME = /\b(service|services|support|maintenance|training|installation|install|calibration|labor|labour|travel|on-?site|repair|visit|inspection|contract|agreement|warranty|coverage|subscription|plan|pm)\b/i;
const INSTRUMENT_NAME = /\b(instrument|analy[sz]er|cytometer|system|platform|machine)\b/i;
/** A physical-item noun outranks the words above ("Laser Shield Support" and "Instrument Filter" are parts). */
const PART_NOUN = /\b(bracket|plate|mount|kit|filter|filters|cable|board|assembly|assy|cover|frame|tubing|tube|probe|lens|prism|module|sensor|pump|valve|screw|switch|fan|motor|beads|reagent|bottle|adapter|holder|spring|crate|label|manual|tray|seal|gasket|o-ring|fuse|belt|laser|pcb|harness|fitting|nozzle|syringe|cartridge|card|drive|supply|battery|hose|clamp|knob|panel|shield|window|mirror|diode|fiber|fibre)\b/i;

interface ClassifyInput {
  name: string;
  unit: string;
  listPrice: number;
  hasInternalId: boolean;
  explicitCategory: string;
}
interface ClassifyContext {
  /** true when the sheet has an item-id column that most rows fill in (Cytek-style catalogs). */
  idSignal: boolean;
}

/**
 * Which quote control a pricing row belongs to.
 *  1. An explicit Category/Type column wins.
 *  2. Time/visit sale units are services (contracts included).
 *  3. Catalogs with a populated item-id column: priced rows without an id are
 *     ad-hoc services, everything else is a part (the original Cytek rule).
 *  4. Otherwise the name decides: instruments/systems, services, else parts.
 */
export function classifyProduct(row: ClassifyInput, ctx: ClassifyContext): ProductCategory {
  const explicit = categoryFromLabel(row.explicitCategory);
  if (explicit) return explicit;
  if (SERVICE_UNITS.has(row.unit.trim().toLowerCase())) return "Service";
  if (ctx.idSignal) return !row.hasInternalId && row.listPrice > 0 ? "Service" : "Parts";
  if (PART_NOUN.test(row.name)) return "Parts";
  if (SERVICE_NAME.test(row.name)) return "Service";
  if (INSTRUMENT_NAME.test(row.name)) return "Instrument";
  return "Parts";
}

const REJECT_SAMPLE_LIMIT = 10;

/** Rows whose only name is an adjustment label (no display name in the source). */
const ADJUSTMENT_NAME = /discount|surcharge|offset|allowance|trade-in/i;

/** Header text -> comparison key: lower-case, punctuation/whitespace collapsed. */
export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

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
    const key = normalizeHeader(h);
    if (key && !index.has(key)) index.set(key, i);
  });

  const columns: Partial<Record<F, number>> = {};
  const headersUsed: Partial<Record<F, string>> = {};
  const taken = new Set<number>();
  for (const field of Object.keys(headers) as F[]) {
    let col: number | undefined;
    for (const h of headers[field]) {
      if (h.startsWith("~")) continue;
      const c = index.get(normalizeHeader(h));
      if (c !== undefined && !taken.has(c)) {
        col = c;
        break;
      }
    }
    if (col === undefined) {
      for (const h of headers[field]) {
        if (!h.startsWith("~")) continue;
        const needle = normalizeHeader(h.slice(1));
        const c = headerRow.findIndex((raw, i) => !taken.has(i) && normalizeHeader(raw).includes(needle));
        if (c >= 0) {
          col = c;
          break;
        }
      }
    }
    if (col !== undefined) {
      columns[field] = col;
      headersUsed[field] = headerRow[col];
      taken.add(col);
    }
  }
  const missing = required.filter((f) => columns[f] === undefined);
  if (missing.length) {
    throw new Error(
      `${fileLabel}: sheet "${sheetName}" is missing expected column(s): ` +
        missing.map((f) => headers[f].filter((h) => !h.startsWith("~")).slice(0, 4).map((h) => `"${h}"`).join(" or ") + (headers[f].length > 4 ? " (or similar)" : "")).join(", ") +
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

  // Separate State / ZIP columns (common outside the Cytek export) feed stateZip.
  const extras = readSheet<AssetExtraField>(input.primary.workbook, ASSET_SHEET, ASSET_EXTRA_HEADERS, [], primaryLabel);
  if (!primaryAssets.headersUsed.stateZip && (extras.headersUsed.state || extras.headersUsed.zip)) {
    mappings["stateZip"] = `primary ${ASSET_SHEET}!${[extras.headersUsed.state, extras.headersUsed.zip].filter(Boolean).join(" + ")}`;
  }

  const assets: NormalizedAsset[] = [];
  const byKey = new Map<string, NormalizedAsset>();
  for (const [i, row] of primaryAssets.rows.entries()) {
    const a = assetFromRow(row);
    if (!a.stateZip) {
      const extra = extras.rows[i];
      a.stateZip = [str(extra?.state), str(extra?.zip)].filter(Boolean).join(" ");
    }
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
  // The "no item id => ad-hoc service" rule only means something when the
  // catalog actually assigns ids (Cytek does); a workbook without that column
  // must not have every priced row become a service.
  const idColumnRows = pricing.headersUsed.itemInternalId ? pricing.rows.filter((r) => str(r.partName) || str(r.partNumber)) : [];
  const idSignal = idColumnRows.length > 0 && idColumnRows.filter((r) => str(r.itemInternalId) !== "").length * 2 >= idColumnRows.length;
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
    const category = classifyProduct(
      { name: partName, unit, listPrice, hasInternalId: str(r.itemInternalId) !== "", explicitCategory: str(r.category) },
      { idSignal },
    );
    products.push({
      partName,
      partNumber,
      listPrice,
      netPrice: listPrice,
      category,
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
  productMappings["category"] = pricing.headersUsed.category
    ? `${pricing.headersUsed.category} column when recognized; else Service if ${pricing.headersUsed.unit ?? "unit"} is a time/visit unit; else ${idSignal ? `Service when priced with no ${pricing.headersUsed.itemInternalId}` : "by name (instrument/service keywords)"}; otherwise Parts`
    : idSignal
      ? `Service if ${pricing.headersUsed.unit ?? "Sale Unit"} is a time/visit unit (Year/2 Years/3 Years/Hour/…), or the row is priced but has no ${pricing.headersUsed.itemInternalId}; otherwise Parts`
      : `Service if ${pricing.headersUsed.unit ?? "unit"} is a time/visit unit; else by name: physical-item nouns => Parts, service/contract words => Service, instrument/system words => Instrument; otherwise Parts (add a "Category" column to the sheet to classify rows explicitly)`;

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
