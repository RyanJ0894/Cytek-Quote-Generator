/**
 * Cytek importer: transforms the "Cytek Quoting Tool" workbook(s) into the
 * normalized Data Source records (see ../types.ts).
 *
 * This is the ONLY place that knows Cytek's sheet names and column headers.
 * It reads the underlying data sheets directly (never the workbook's VLOOKUP
 * formulas, several of which are #REF! in Rev6) and locates columns by header
 * text, so column re-ordering in a future revision does not silently shift
 * fields the way the previous positional parser could.
 *
 * Inputs
 *  - primary:    Rev6. Source of truth for WHICH assets exist and for account,
 *                product, contract number/type/end date, country, install date
 *                and asset status. Also the pricing catalog.
 *  - supplement: Rev5 (optional). Rev6's asset export dropped the facility
 *                code, street address, contact and territory columns that
 *                Manual Mode populates, so those are carried over from Rev5
 *                for serials that still exist in Rev6. Serials only in the
 *                supplement are NOT imported (Rev6 decides what exists).
 */
import xlsx from "xlsx";
import type {
  DataSourceManifest,
  NormalizedAsset,
  NormalizedProduct,
  RejectedSummary,
  SourceFileInfo,
} from "../types.js";
import { normalizeSerial } from "../static-source.js";

export const CYTEK_DATA_SOURCE_ID = "cytek";
export const CYTEK_DATA_SOURCE_NAME = "Cytek";

export const ASSET_SHEET = "Asset Data";
export const PRICING_SHEET = "Pricing Data";

/** Rev6 "Asset Data" headers (primary). */
const PRIMARY_ASSET_HEADERS = {
  productName: "Product: Product Name",
  serialNumber: "Serial Number",
  installDate: "Install Date",
  contractNumber: "Synced Contract: Contract Number",
  assetStatus: "Status",
  accountName: "Account Name",
  contractEndDate: "Synced Contract: Contract End Date",
  country: "Country",
  contractType: "Synced Contract: Contract Type",
} as const;

/** Rev5 "Asset Data" headers (supplement) — only the columns Rev6 lacks. */
const SUPPLEMENT_ASSET_HEADERS = {
  serialNumber: "Asset Name",
  accountName: "Account: Account Name",
  facilityName: "shortened facility name",
  serviceTerritory: "Service Territory: Name",
  primaryTechnician: "Primary Service Technician",
  primaryFas: "Primary FAS",
  contactName: "Contact: Full Name",
  contactEmail: "Contact: Email",
  street: "Street",
  city: "City",
  stateZip: "State and Zip code",
  region: "Region",
} as const;

/** "Pricing Data" headers (identical in Rev5 and Rev6). */
const PRICING_HEADERS = {
  partName: "Display Name",
  unit: "Sale Unit",
  listPrice: "Unit Price",
  partNumber: "Part Number",
  itemInternalId: "Item Internal ID",
} as const;

/** Sale units that identify a service/contract SKU rather than a physical part. */
const SERVICE_UNITS = new Set(["year", "2 years", "3 years", "hour"]);

const REJECT_SAMPLE_LIMIT = 10;

type Row = Record<string, unknown>;

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(str(v).replace(/[,$]/g, ""));
  return Number.isFinite(n) ? n : 0;
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

/**
 * Reads a sheet into objects keyed by the exact header text, verifying that
 * every required header is present. Header matching trims whitespace and
 * ignores case; the returned keys are the canonical names from `required`.
 */
export function readSheetByHeaders(
  wb: xlsx.WorkBook,
  sheetName: string,
  required: readonly string[],
  fileLabel: string,
): Row[] {
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new Error(`${fileLabel}: sheet "${sheetName}" not found (sheets: ${wb.SheetNames.join(", ")})`);
  }
  const grid = xlsx.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
  const headerRow = (grid[0] ?? []).map((h) => str(h));
  const index = new Map<string, number>();
  headerRow.forEach((h, i) => index.set(h.toLowerCase(), i));

  const missing = required.filter((h) => !index.has(h.toLowerCase()));
  if (missing.length) {
    throw new Error(
      `${fileLabel}: sheet "${sheetName}" is missing expected column(s): ${missing.map((m) => `"${m}"`).join(", ")}. ` +
        `Found: ${headerRow.filter(Boolean).join(" | ")}`,
    );
  }

  return grid.slice(1).map((cells) => {
    const row: Row = {};
    for (const h of required) row[h] = cells[index.get(h.toLowerCase())!] ?? "";
    return row;
  });
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

export interface CytekImportInput {
  primary: { workbook: xlsx.WorkBook; file: Omit<SourceFileInfo, "role" | "sheetsUsed"> };
  supplement?: { workbook: xlsx.WorkBook; file: Omit<SourceFileInfo, "role" | "sheetsUsed"> };
  /** Injectable for deterministic tests. */
  now?: Date;
}

export interface CytekImportResult {
  assets: NormalizedAsset[];
  products: NormalizedProduct[];
  manifest: DataSourceManifest;
}

export function importCytek(input: CytekImportInput): CytekImportResult {
  const rejected = new Rejections();
  const primaryLabel = input.primary.file.label;

  // ── Assets (primary) ───────────────────────────────────────────────
  const primaryRows = readSheetByHeaders(
    input.primary.workbook,
    ASSET_SHEET,
    Object.values(PRIMARY_ASSET_HEADERS),
    primaryLabel,
  );

  const assets: NormalizedAsset[] = [];
  const seen = new Set<string>();
  for (const r of primaryRows) {
    const serialNumber = str(r[PRIMARY_ASSET_HEADERS.serialNumber]);
    const accountName = str(r[PRIMARY_ASSET_HEADERS.accountName]);
    if (!serialNumber) {
      rejected.add("asset: blank serial number", accountName || "(blank row)");
      continue;
    }
    const key = normalizeSerial(serialNumber);
    if (seen.has(key)) {
      rejected.add("asset: duplicate serial number (first occurrence kept)", serialNumber);
      continue;
    }
    seen.add(key);
    assets.push({
      serialNumber,
      assetName: serialNumber,
      accountName,
      facilityName: "",
      serviceTerritory: "",
      primaryTechnician: "",
      contractNumber: str(r[PRIMARY_ASSET_HEADERS.contractNumber]),
      contractType: str(r[PRIMARY_ASSET_HEADERS.contractType]),
      contractEndDate: toIsoDate(r[PRIMARY_ASSET_HEADERS.contractEndDate]),
      productName: str(r[PRIMARY_ASSET_HEADERS.productName]),
      contactName: "",
      contactEmail: "",
      street: "",
      city: "",
      stateZip: "",
      region: "",
      country: str(r[PRIMARY_ASSET_HEADERS.country]),
      assetStatus: str(r[PRIMARY_ASSET_HEADERS.assetStatus]),
      installDate: toIsoDate(r[PRIMARY_ASSET_HEADERS.installDate]),
    });
  }

  // ── Assets (supplement enrichment) ─────────────────────────────────
  let enriched = 0;
  let enrichedDifferentAccount = 0;
  const supplementSheets: string[] = [];
  if (input.supplement) {
    const supRows = readSheetByHeaders(
      input.supplement.workbook,
      ASSET_SHEET,
      Object.values(SUPPLEMENT_ASSET_HEADERS),
      input.supplement.file.label,
    );
    supplementSheets.push(ASSET_SHEET);
    const byKey = new Map(assets.map((a) => [normalizeSerial(a.serialNumber), a]));
    for (const r of supRows) {
      const serial = str(r[SUPPLEMENT_ASSET_HEADERS.serialNumber]);
      if (!serial) continue;
      const target = byKey.get(normalizeSerial(serial));
      if (!target) {
        rejected.add("asset: only in supplement (not in primary), skipped", serial);
        continue;
      }
      target.facilityName = str(r[SUPPLEMENT_ASSET_HEADERS.facilityName]);
      target.serviceTerritory = str(r[SUPPLEMENT_ASSET_HEADERS.serviceTerritory]);
      target.primaryTechnician =
        str(r[SUPPLEMENT_ASSET_HEADERS.primaryTechnician]) || str(r[SUPPLEMENT_ASSET_HEADERS.primaryFas]);
      target.contactName = str(r[SUPPLEMENT_ASSET_HEADERS.contactName]);
      target.contactEmail = str(r[SUPPLEMENT_ASSET_HEADERS.contactEmail]);
      target.street = str(r[SUPPLEMENT_ASSET_HEADERS.street]);
      target.city = str(r[SUPPLEMENT_ASSET_HEADERS.city]);
      target.stateZip = str(r[SUPPLEMENT_ASSET_HEADERS.stateZip]);
      target.region = str(r[SUPPLEMENT_ASSET_HEADERS.region]);
      enriched += 1;
      if (str(r[SUPPLEMENT_ASSET_HEADERS.accountName]).toLowerCase() !== target.accountName.toLowerCase()) {
        enrichedDifferentAccount += 1;
      }
    }
  }

  let facilityDefaulted = 0;
  for (const a of assets) {
    if (!a.facilityName) {
      a.facilityName = a.accountName;
      facilityDefaulted += 1;
    }
  }

  // ── Products (primary) ─────────────────────────────────────────────
  const priceRows = readSheetByHeaders(
    input.primary.workbook,
    PRICING_SHEET,
    Object.values(PRICING_HEADERS),
    primaryLabel,
  );
  const products: NormalizedProduct[] = [];
  for (const r of priceRows) {
    const partName = str(r[PRICING_HEADERS.partName]);
    const listPrice = num(r[PRICING_HEADERS.listPrice]);
    if (!partName) {
      rejected.add("product: blank display name", str(r[PRICING_HEADERS.partNumber]) || "(blank row)");
      continue;
    }
    if (listPrice <= 0) {
      rejected.add("product: no unit price", partName);
      continue;
    }
    const unit = str(r[PRICING_HEADERS.unit]);
    const hasInternalId = str(r[PRICING_HEADERS.itemInternalId]) !== "";
    const isService = SERVICE_UNITS.has(unit.toLowerCase()) || !hasInternalId;
    products.push({
      partName,
      partNumber: str(r[PRICING_HEADERS.partNumber]),
      listPrice,
      netPrice: listPrice,
      category: isService ? "Service" : "Parts",
      unit,
    });
  }

  const manifest: DataSourceManifest = {
    id: CYTEK_DATA_SOURCE_ID,
    name: CYTEK_DATA_SOURCE_NAME,
    importedAt: (input.now ?? new Date()).toISOString(),
    sources: [
      { role: "primary", ...input.primary.file, sheetsUsed: [ASSET_SHEET, PRICING_SHEET] },
      ...(input.supplement ? [{ role: "supplement" as const, ...input.supplement.file, sheetsUsed: supplementSheets }] : []),
    ],
    counts: {
      assets: assets.length,
      products: products.length,
      services: products.filter((p) => p.category === "Service").length,
      assetsEnrichedFromSupplement: enriched,
      assetsEnrichedWithDifferentAccountName: enrichedDifferentAccount,
      assetsFacilityDefaultedToAccount: facilityDefaulted,
    },
    rejected: rejected.toJSON(),
    fieldMappings: {
      assets: {
        serialNumber: `primary ${ASSET_SHEET}!${PRIMARY_ASSET_HEADERS.serialNumber}`,
        assetName: "= serialNumber",
        accountName: `primary ${ASSET_SHEET}!${PRIMARY_ASSET_HEADERS.accountName}`,
        productName: `primary ${ASSET_SHEET}!${PRIMARY_ASSET_HEADERS.productName}`,
        contractNumber: `primary ${ASSET_SHEET}!${PRIMARY_ASSET_HEADERS.contractNumber}`,
        contractType: `primary ${ASSET_SHEET}!${PRIMARY_ASSET_HEADERS.contractType}`,
        contractEndDate: `primary ${ASSET_SHEET}!${PRIMARY_ASSET_HEADERS.contractEndDate} (ISO date)`,
        contractStatus: "derived at lookup: Activated if contractEndDate >= today, Expired if past, blank if none",
        country: `primary ${ASSET_SHEET}!${PRIMARY_ASSET_HEADERS.country}`,
        assetStatus: `primary ${ASSET_SHEET}!${PRIMARY_ASSET_HEADERS.assetStatus}`,
        installDate: `primary ${ASSET_SHEET}!${PRIMARY_ASSET_HEADERS.installDate} (ISO date)`,
        facilityName: `supplement ${ASSET_SHEET}!${SUPPLEMENT_ASSET_HEADERS.facilityName}; falls back to accountName`,
        street: `supplement ${ASSET_SHEET}!${SUPPLEMENT_ASSET_HEADERS.street}`,
        city: `supplement ${ASSET_SHEET}!${SUPPLEMENT_ASSET_HEADERS.city}`,
        stateZip: `supplement ${ASSET_SHEET}!${SUPPLEMENT_ASSET_HEADERS.stateZip}`,
        region: `supplement ${ASSET_SHEET}!${SUPPLEMENT_ASSET_HEADERS.region}`,
        serviceTerritory: `supplement ${ASSET_SHEET}!${SUPPLEMENT_ASSET_HEADERS.serviceTerritory}`,
        primaryTechnician: `supplement ${ASSET_SHEET}!${SUPPLEMENT_ASSET_HEADERS.primaryTechnician} (else ${SUPPLEMENT_ASSET_HEADERS.primaryFas})`,
        contactName: `supplement ${ASSET_SHEET}!${SUPPLEMENT_ASSET_HEADERS.contactName}`,
        contactEmail: `supplement ${ASSET_SHEET}!${SUPPLEMENT_ASSET_HEADERS.contactEmail}`,
      },
      products: {
        partName: `primary ${PRICING_SHEET}!${PRICING_HEADERS.partName}`,
        partNumber: `primary ${PRICING_SHEET}!${PRICING_HEADERS.partNumber}`,
        listPrice: `primary ${PRICING_SHEET}!${PRICING_HEADERS.listPrice}`,
        netPrice: "= listPrice (the workbook has no customer net price; 'Last Purchase Price' is internal cost and is not imported)",
        unit: `primary ${PRICING_SHEET}!${PRICING_HEADERS.unit}`,
        category: `Service if ${PRICING_HEADERS.unit} is Year/2 Years/3 Years/Hour or ${PRICING_HEADERS.itemInternalId} is blank; otherwise Parts`,
      },
    },
    notes: [
      "Underlying data sheets are read directly; the workbook's FSE Input VLOOKUP formulas (#REF! in Rev6) are not used.",
      "Rev6's Asset Data export has no facility code, address, contact or territory columns; those are carried over from the Rev5 supplement for serials present in Rev6.",
      "Assets present only in the supplement are not imported: the primary workbook defines which assets exist.",
      "Where the account name changed between Rev5 and Rev6, the carried-over address/contact may be out of date; all populated fields remain editable in the form.",
    ],
  };

  return { assets, products, manifest };
}
