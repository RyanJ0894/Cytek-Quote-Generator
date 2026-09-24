/**
 * Data Sources — the normalized data model that Manual Mode looks up against.
 *
 * A Data Source is one company's asset catalog plus product/pricing catalog,
 * already transformed from the shape it arrived in (a "Cytek Quoting Tool"
 * style workbook) into these normalized records. Manual Mode and the API only
 * ever see these types; workbook parsing lives in workbook-importer.ts.
 *
 * Every source lives in a DataSourceStore (./store.ts) as one persistent,
 * isolated dataset. The Cytek data compiled into the server (./cytek) is only
 * a seed: it is saved into the store on first start and from then on is an
 * ordinary source the user can update, replace or delete.
 */

import type { QuoteProfile, QuoteProfileSummary } from "./quote-profile.js";

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

/**
 * Which Manual Quote control a product belongs to: "Service" (labor, support,
 * service contracts and warranties: the Service Type control), "Parts"
 * (components and consumables) and "Instrument" (capital equipment); the last
 * two are quoted as line items in Parts Configuration.
 */
export type ProductCategory = "Service" | "Parts" | "Instrument";

export interface NormalizedProduct {
  partName: string;
  partNumber: string;
  /** List price from the source, or 0 when the source has no price (see `priced`). */
  listPrice: number;
  /** Customer-facing net price. Equal to listPrice unless a source provides a real net price. */
  netPrice: number;
  category: ProductCategory;
  /** Sale unit from the source (e.g. "Each", "Year"), or "". */
  unit: string;
  /**
   * false when the source workbook has no usable list price for this item.
   * Such items are still searchable so the user learns that the catalog has
   * no price rather than wondering why the item is missing.
   */
  priced: boolean;
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
    /** All imported products, priced or not. */
    products: number;
    pricedProducts: number;
    unpricedProducts: number;
    services: number;
    assetsEnrichedFromSupplement: number;
    /** Enriched assets whose account name differs between primary and supplement (address may be stale). */
    assetsEnrichedWithDifferentAccountName: number;
    assetsFacilityDefaultedToAccount: number;
  };
  rejected: Record<string, RejectedSummary>;
  /** Normalized field -> "<role> <sheet>!<column header>" (or a note) for traceability. */
  fieldMappings: {
    assets: Record<string, string>;
    products: Record<string, string>;
  };
  notes: string[];
}

/** A data source as persisted in a DataSourceStore. */
export interface StoredDataSource {
  id: string;
  name: string;
  manifest: DataSourceManifest;
  assets: NormalizedAsset[];
  products: NormalizedProduct[];
  /** ISO timestamp; changes on every write and is used as the cache version. */
  updatedAt: string;
}

/** Data compiled into the server that is saved into the store on first start. */
export type SeedDataSource = Omit<StoredDataSource, "updatedAt"> & {
  /** Seller identity/branding saved alongside the data (see quote-profile.ts). */
  quoteProfile?: QuoteProfile;
};

export interface DataSourceSummary {
  id: string;
  name: string;
  isDefault: boolean;
  /** Seller identity status for this source; documents cannot be generated until it is complete. */
  quoteProfile: QuoteProfileSummary;
  importedAt: string;
  /** Last time the source was created or its workbook replaced. */
  updatedAt: string;
  sourceFiles: string[];
  assetCount: number;
  productCount: number;
  unpricedProductCount: number;
}

export interface DataSource {
  readonly id: string;
  readonly name: string;
  readonly manifest: DataSourceManifest;
  /** Sorted, de-duplicated serial numbers for autocomplete. */
  listSerials(): string[];
  /** Exact, case-insensitive, whitespace-trimmed match. */
  lookupAsset(serial: string): AssetLookupResult | null;
  /** All products (parts and services), priced or not. */
  listProducts(): NormalizedProduct[];
  /** Products in the "Service" category. */
  listServices(): NormalizedProduct[];
}
