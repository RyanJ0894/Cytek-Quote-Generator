import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * One row per persisted Data Source. The normalized asset/product records are
 * stored as JSON blobs: they are only ever loaded whole into memory and
 * indexed there (a few MB per source), so relational tables would add
 * migrations and joins without buying anything for this app's lookups.
 */
export const dataSourcesTable = pgTable("data_sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  manifest: jsonb("manifest").notNull(),
  assets: jsonb("assets").notNull(),
  products: jsonb("products").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Small key/value table for app-level settings (e.g. the default data source id). */
export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type DataSourceRow = typeof dataSourcesTable.$inferSelect;
