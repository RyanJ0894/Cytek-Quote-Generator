/**
 * Registry of configured Data Sources and the default selection.
 *
 * Phase 2: a single static source (Cytek). The active company's
 * `dataSourceId` (see @workspace/config) selects the default, so adding a
 * company later means registering its source here and pointing its
 * CompanyConfig at it — routes and the frontend stay unchanged.
 */
import { activeCompany } from "@workspace/config";
import type { DataSource, DataSourceSummary } from "./types.js";
import { cytekDataSource } from "./cytek/index.js";

const registry: Record<string, DataSource> = {
  [cytekDataSource.id]: cytekDataSource,
};

export const DEFAULT_DATA_SOURCE_ID: string = activeCompany.dataSourceId ?? cytekDataSource.id;

export function getDefaultDataSource(): DataSource {
  const ds = registry[DEFAULT_DATA_SOURCE_ID];
  if (!ds) {
    throw new Error(
      `Default data source "${DEFAULT_DATA_SOURCE_ID}" is not registered (known: ${Object.keys(registry).join(", ")})`,
    );
  }
  return ds;
}

export function listDataSources(): DataSource[] {
  return Object.values(registry);
}

export function summarize(ds: DataSource): DataSourceSummary {
  return {
    id: ds.id,
    name: ds.name,
    isDefault: ds.id === DEFAULT_DATA_SOURCE_ID,
    importedAt: ds.manifest.importedAt,
    sourceFiles: ds.manifest.sources.map((s) => s.label),
    assetCount: ds.manifest.counts.assets,
    productCount: ds.manifest.counts.products,
  };
}
