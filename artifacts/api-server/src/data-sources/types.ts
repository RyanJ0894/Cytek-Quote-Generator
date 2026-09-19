/**
 * Data Sources — the normalized data model that Manual Mode looks up against.
 *
 * A Data Source is one company's asset catalog plus product/pricing catalog,
 * already transformed from whatever shape it arrived in (today: Cytek's Excel
 * workbook) into these normalized records. Manual Mode and the API only ever
 * see these types; workbook-specific parsing lives in the importer for that
 * data source (see ./cytek/importer.ts).
 *
 * Phase 2 ships exactly one data source (Cytek, the default). The interface is
 * deliberately small so that a future database-backed or user-uploaded source
 * can implement it without touching routes or the frontend.
 */

export interface NormalizedAsset {
  /** Lookup key. Trimmed; matched case-insensitively. */
  serialNumber: string;
  /** Kept for API compatibility; always equal to serialNumber today. */
  assetName: string;
  accountName: string;
  /** Short facility code (e.g. "RGON") when known; otherwise the account name. */
  facilityName: string;
  serviceTerritory: string;
  primaryTechnician: string;
  contractNumber: string;
  contractType: string;
  /**
   * ISO date (YYYY-MM-DD) or "". Contract status is derived from this at
   * lookup time so it never goes stale between imports.
   */
  contractEndDate: string;
  productName: string;
  contactName: string;
  contactEmail: string;
  street: string;
  city: string;
  stateZip: string;
  region: string;
  country: string;
  /** Asset lifecycle status from the source (e.g. "Installed"). */
  assetStatus: string;
  /** ISO date (YYYY-MM-DD) or "". */
  installDate: string;
}

/** What a lookup returns: the stored record plus the status derived from its contract end date. */
export type AssetLookupResult = NormalizedAsset & { contractStatus: string };

export type ProductCategory = "Service" | "Parts";

export interface NormalizedProduct {
  partName: string;
  partNumber: string;
  listPrice: number;
  /** Customer-facing net price. Equal to listPrice unless a source provides a real net price. */
  netPrice: number;
  category: ProductCategory;
  /** Sale unit from the source (e.g. "Each", "Year"), or "". */
  unit: string;
}

export interface SourceFileInfo {
  role: "primary" | "supplement";
  fileName: string;
  /** Human-readable label, e.g. the original workbook name/revision. */
  label: string;
  sha256: string;
  sheetsUsed: string[];
}

export interface RejectedSummary {
  count: number;
  /** Up to a handful of examples so the import report is self-explanatory. */
  samples: string[];
}

export interface DataSourceManifest {
  id: string;
  name: string;
  importedAt: string;
  sources: SourceFileInfo[];
  counts: {
    assets: number;
    products: number;
    services: number;
    assetsEnrichedFromSupplement: number;
    /** Enriched assets whose account name differs between primary and supplement (address may be stale). */
    assetsEnrichedWithDifferentAccountName: number;
    assetsFacilityDefaultedToAccount: number;
  };
  rejected: Record<string, RejectedSummary>;
  /** Normalized field -> "<sheet>!<column header>" (or a note) for traceability. */
  fieldMappings: {
    assets: Record<string, string>;
    products: Record<string, string>;
  };
  notes: string[];
}

export interface DataSourceSummary {
  id: string;
  name: string;
  isDefault: boolean;
  importedAt: string;
  sourceFiles: string[];
  assetCount: number;
  productCount: number;
}

export interface DataSource {
  readonly id: string;
  readonly name: string;
  readonly manifest: DataSourceManifest;
  /** Sorted, de-duplicated serial numbers for autocomplete. */
  listSerials(): string[];
  /** Exact, case-insensitive, whitespace-trimmed match. */
  lookupAsset(serial: string): AssetLookupResult | null;
  /** All priced products (parts and services). */
  listProducts(): NormalizedProduct[];
  /** Products in the "Service" category. */
  listServices(): NormalizedProduct[];
}
