# Development Notes

Internal notes for engineers working on Evans Quote Generator. For setup/run instructions, see `README.md`.

## Architecture Overview

Evans Quote Generator is a pnpm-workspace monorepo with two deployable services and a set of shared library packages:

```
┌─────────────────────────┐        ┌──────────────────────────┐
│  quoting-tool (frontend)│  HTTP  │   api-server (backend)    │
│  React + Vite            │◄──────►│   Express 5 + TypeScript  │
│  served as static assets │  /api  │   reads xlsx, writes PDF  │
└─────────────────────────┘        └──────────────────────────┘
              │                                  │
              ▼                                  ▼
   lib/api-client-react              artifacts/api-server/src/data-sources
   (generated React Query hooks,          (Data Sources: normalized assets +
    typed from lib/api-spec)                pricing, each with a Quote Profile)
```

- The **frontend** (`artifacts/quoting-tool`) is a static single-page app with three routes: `/` (Create a Quote: pick a Data Source, or an onboarding card when none exist), `/quote/:id` (Manual Quote scoped to that source) and `/data-sources` (source management, the only place workbooks are uploaded). It calls the API server's JSON endpoints and downloads a PDF blob from `/api/quotes/generate`.
- The **backend** (`artifacts/api-server`) owns all data (the Data Source, see below) and all document generation (PDFKit). It is stateless — nothing is persisted between requests.
- **Quote Profiles** hold everything seller-specific (name, address, contact info, logo, contract language, notes, PDF colors), one per Data Source, stored with the source. The application itself has no seller identity. See "Quote Profiles" below.
- **`lib/api-spec` → `lib/api-zod` / `lib/api-client-react`**: the API surface is defined once in `lib/api-spec/openapi.yaml` and code-generated into a typed React Query client (`lib/api-client-react`) and Zod schemas (`lib/api-zod`). Do not hand-edit files under `src/generated/` in either package — re-run `pnpm --filter @workspace/api-spec run codegen`.
- **`lib/db`** is a Drizzle ORM + Postgres scaffold that exists but is **not currently used** by any route. It's reserved for future persistence (quote history, user accounts). See "Known Limitations".

## Major Components

### `artifacts/api-server/src/data-sources/` — Data Sources
Every Data Source is one persistent, isolated Source of Truth: a company's or dataset's normalized asset catalog plus product/pricing catalog (`types.ts`: `NormalizedAsset`, `NormalizedProduct`, `DataSource`). Routes only ever talk to `DataSourceService` (`service.ts`), which keeps all sources in a `DataSourceStore` (`store.ts`): `MemoryDataSourceStore` (no persistence), `FileDataSourceStore` (`DATA_SOURCES_DIR`, JSON files) or `PgDataSourceStore` (`DATABASE_URL`, plain SQL over `pg`; tables `data_sources` + `app_settings` created on first use; reference schema in `lib/db/src/schema/data-sources.ts`). Whole sources are stored as JSON blobs and indexed in memory (`static-source.ts`), cached per id and invalidated by the store's `updatedAt` version stamp. A lookup always runs against exactly one resolved source; sources are never merged.

The Cytek data compiled into the server (`cytek/`: generated `assets.json`/`products.json`/`manifest.json` from `cytek/import.ts`) is a **seed** (`cytekSeed`): on first use the service saves it into the store as "Cytek — Current" and writes a `seeded:cytek` marker so a seed the user later deletes stays deleted. After that it is an ordinary source. The default source is the stored default id if still present, else the first source by name, else none (the API answers 404 "No data sources configured" and the home page shows onboarding).

`workbook-importer.ts` (`importWorkbook`) is the **only** code that knows the workbook layout. It reads `Asset Data` and `Pricing Data` by column header (accepting either the Rev6 or the Rev5 header names, or both), fails loudly on a missing required column, and never evaluates the workbook's formulas. An optional supplement workbook fills asset fields the primary left blank (the built-in Cytek source uses Rev5 this way because Rev6's export dropped facility code, address, contact and territory). Rules worth knowing:

- assets: blank serial or duplicate serial rows are rejected; facility falls back to the account name; `contractStatus` is derived at lookup time from `contractEndDate`.
- products: name falls back to the part number; prices are rounded to cents; rows with no/zero unit price are **imported with `priced: false`** so they stay searchable and the form can say "no list price" instead of hiding them; negative-priced rows and adjustment labels (discount/surcharge/offset) are rejected as not quotable; `category` is "Service" for Year/2 Years/3 Years/Hour sale units or priced rows without an internal item id, otherwise "Parts"; `netPrice` equals `listPrice` (the internal "Last Purchase Price" column is never imported).

Every import writes a manifest (source files + sha256, counts, rejections with samples, field mappings, notes), visible via `GET /api/data-sources`.

### `artifacts/api-server/src/lib/fseUploadParser.ts`
Pure parsing functions for the "FSE Input" sheet of an uploaded customer-filled workbook (Upload Mode). It reads fixed cell positions and the workbook's cached cell values; where the workbook's own lookup formulas are broken (#REF!, as in Rev6) those fields come through blank and the form's serial lookup fills them from the Data Source instead. Deliberately has no Express/HTTP dependency so it can be unit tested directly.

### `artifacts/api-server/src/lib/pdf.ts`
Company-agnostic PDFKit drawing primitives: page/column layout constants, `fmtDate`/`fmtMoney`, and functions to draw table rows, headers, totals, the page footer, and the page header (logo + date + quote number box). Every function that renders text/borders takes color values as parameters instead of hardcoding them, so it can be reused by any `CompanyConfig`.

### `artifacts/api-server/src/routes/quotes.ts`
The business logic and route handler for `POST /api/quotes/generate`. Reads the active `CompanyConfig`, assembles line items and totals from the request body, and calls into `lib/pdf.ts` to render the two-part document (quote page(s) + terms & conditions pages). This file intentionally does not know how to draw anything — it only knows what to draw and in what order.

### `artifacts/api-server/src/data-sources/workbook-importer.ts` — any properly laid-out workbook

Columns are matched by normalized header (lower-case, punctuation collapsed) against alias lists per field, so "Serial #", "serial_number" and "Serial Number" are the same column; an alias written `~serial` matches any header containing that text and is tried last. Separate State + Zip columns are combined into `stateZip`. Only a serial column and an account/customer column are required for assets; only a name and a price for pricing rows.

Pricing rows are classified by `classifyProduct` into `Service` (Service Type control: labor, support, service contracts, warranties), `Parts` and `Instrument` (both are line items in Parts Configuration): an explicit Category/Type column wins; then time/visit sale units are services; then, for catalogs whose item-id column is populated (Cytek), priced rows without an id are ad-hoc services and everything else is a part (the original rule, unchanged for Cytek); otherwise the name decides, with physical-item nouns (bracket, filter, kit, …) outranking service/instrument words. The manifest's `fieldMappings.products.category` records which rule applied. Cytek's bundled `products.json` is unaffected.

### `artifacts/quoting-tool/src/components/Autocomplete.tsx` — Source-driven selectors

Serial Number, Service Type and Part Description use this combobox. The committed `value` and the filter text are separate state: opening the list shows every record of the active source (selected one highlighted), typing narrows it, selecting commits and resets the filter, so reopening never shows just the selected entry. The × button clears the value and calls `onClear` (the form resets the dependent price/part number). Keyboard: arrows, Enter, Escape.

### `artifacts/quoting-tool/src/components/QuoteForm.tsx`
The main form. Owns client-side validation (Zod + React Hook Form), live total calculation, serial-number-triggered asset lookup, and submission to `POST /api/quotes/generate` (downloading the returned PDF blob).

### `artifacts/quoting-tool/src/pages/`
`home.tsx` (source picker / onboarding), `quote.tsx` (Manual Quote for `/quote/:id`; remounts `QuoteForm` keyed by source id so switching sources restarts the quote) and `data-sources.tsx` (management). `components/AppHeader.tsx` is the shared header. The former per-quote "FSE Input" upload UI was removed from the quoting path; its server endpoint (`POST /api/quotes/parse-upload`, `lib/fseUploadParser.ts`) remains, unused by the UI.

## Persistence and serverless

`createStoreFromEnv` (`data-sources/service.ts`) picks Postgres when any of `DATABASE_URL`, `POSTGRES_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING` or `NEON_DATABASE_URL` is set (the names Vercel's Postgres integrations write), else the file store when `DATA_SOURCES_DIR` is set, else memory. `pgPoolConfig` adds TLS for non-local hosts that do not already carry `sslmode`, and keeps pools small (`max: 3`) because every function instance opens its own. The memory store on Vercel is not merely volatile: instances do not share it, so an uploaded source can be visible to one request and "Unknown data source" to the next. The Quote Form now shows such lookup errors under the Serial field instead of silently leaving the form empty; the Data Sources page explains the situation while no database is connected and names the backend once one is.

## Serial-driven population

Selecting a serial looks the asset up in the active source only and fills every field the record supplies: Customer Name (from the asset contact, only when the field is empty or still holds the previous auto-fill), Account, Facility, Address, Contract Type, Status (derived from the contract end date), Instrument. Blank source values leave blank fields. `QuoteForm` remembers what it auto-filled: when the serial changes or is cleared, fields still holding those values are replaced/cleared and anything the user typed over them is kept. Switching Data Source mid-quote asks for confirmation and remounts the form empty.

The legacy work-type labels ("On-Site Support (1 day)", "PM Service", "Remote Support") are appended to Service Type for the seeded `cytek` source only; every other source lists its own catalog only.

## Quote Profiles (seller identity per Data Source)

`artifacts/api-server/src/data-sources/quote-profile.ts` defines `QuoteProfile`: company name and short name, address, contact (phone, fax, website, email), logo (a PNG/JPEG data URL plus height/width ratio, ≤ 1.5 MB), notes printed under the line items, terms & conditions (title, subtitle, intro, sections) and PDF colors. It also holds `normalizeQuoteProfile` (coerces/validates untrusted input), `quoteProfileStatus` (the required fields: company name, street, city/state/ZIP, phone, email; logo and terms are optional) and `footerLines`.

Profiles are stored **separately from the source data** (`DataSourceStore.getProfile/setProfile`; `quote_profiles` table, `<id>.profile.json`, or the memory map), so replacing a workbook never touches them; deleting a source deletes its profile. A new source has **no** profile: `POST /api/quotes/generate` answers 400 with the missing fields, and the UI shows a "Quote Profile incomplete" badge and disables Generate, until the profile is saved (`PUT /api/data-sources/{id}/profile`). There is no application-wide fallback identity.

`routes/quotes.ts` resolves the request's `dataSource` (default source when omitted), loads that source's profile and renders from it only: logo bytes or the short name as text in the header (`pdf.ts` `HeaderLogo`), footer lines, bullets, colors, and the terms pages (skipped when the profile has no terms). The application shell (`components/AppHeader.tsx`) is a neutral text identity, "EVANS / QUOTE GENERATOR"; no seller branding exists outside a profile.

**Setup flow and management (frontend).** Adding a source on the Data Sources page ends by navigating to `/data-sources/<id>/profile?setup=1`, where the editor shows the import result and, once the saved profile is complete, a "Data Source Ready → Create Quote" state. On the homepage, clicking an incomplete source opens a setup prompt (Complete Quote Profile / Continue to Quote Anyway); a complete source goes straight to Manual Quote, which shows a top-of-page warning only when the profile is incomplete. Each card has a ⋯ menu (`components/SourceMenu.tsx`); the Edit Data Source page is `pages/data-source-manage.tsx`; delete/replace/default/rename actions and the delete confirmation dialog are shared through `hooks/use-data-source-actions.tsx` so every surface changes the same record. `PATCH /api/data-sources/{id}` renames a source (id, data and profile unchanged). The profile editor shows City / State / ZIP as separate inputs but stores the printed `cityStateZip` line (`splitCityStateZip` / `joinCityStateZip`).

The Cytek values formerly in `lib/config` now live in `data-sources/cytek/profile.ts` (with the logo in `cytek/logo-data.ts`) and are seeded with the "Cytek — Current" source. `lib/config` is gone.

## Application Theme (Light / Dark)

- **Tokens, not two designs.** Every UI color is a CSS variable in `artifacts/quoting-tool/src/index.css` (`--background`, `--card`, `--surface`, `--muted-foreground`, `--success`, `--warning`, `--summary`, …) exposed to Tailwind through `@theme inline`. Components use `bg-card`, `text-muted-foreground`, `bg-warning/15` and so on; they must not use raw palette classes such as `bg-white`, `text-slate-700` or `bg-amber-50`, which would stay light in Dark Mode. The dark palette is a designed deep-navy version of the same interface, redefined on `.dark`; `@custom-variant dark` makes Tailwind's `dark:` variant class-based.
- **Switching.** `<html class="dark">` selects the dark tokens. The inline script in `index.html` applies it before first paint: `localStorage["eqg-theme"] === "light"` selects Light Mode, anything else is Dark Mode (the default; the OS `prefers-color-scheme` is deliberately not consulted). `src/hooks/use-theme.ts` (`useTheme`, `useThemeSync`) owns the runtime: the toggle saves the choice; other tabs stay in step via the `storage` event. `ThemeToggle` in `AppHeader` is the only control.
- **Logos.** `src/assets/evans-logo-light.png` (navy lettering) and `evans-logo-dark.png` (metallic lettering) are the supplied assets in `EVANS Quote Generator Logo 1 - *.png` at the repo root, cropped to the same box and downscaled; both `<img>`s are rendered and the `dark` class picks one (`dark:hidden` / `dark:block`), so the header never resizes. Never approximate one logo from the other with CSS filters.
- **Intentional exceptions.** The Quote Profile logo thumbnails sit on a white chip in both themes because they are document assets shown as they print. The quote Summary panel is dark in both themes (`--summary` tokens). Call-to-action buttons use `text-primary-foreground`, which is dark navy in Dark Mode so the bright blue button keeps a 4.5:1 text contrast.
- **Scope.** The theme is application chrome only. PDFs are produced server-side from the Data Source's Quote Profile (`pdfTheme`, logo, footer) and carry nothing from the browser theme.

## Quote Generation Pipeline

1. User fills out `QuoteForm` (either manually or pre-populated via Excel upload) and submits.
2. Frontend calls `POST /api/quotes/generate` with a `QuoteRequest` JSON body (customer info, serial number, service line, parts array, shipping, notes).
3. `routes/quotes.ts` validates the body is a JSON object, builds a flat `allItems` array (service line first, if present, then parts), applies quote-specific discounts (`discountPercent` per line and `serviceDiscountPercent`; an explicit `netPrice` wins) and computes extended prices from the net price and totals.
4. A `PDFDocument` is created and piped directly to the HTTP response (`res`) — the PDF is never written to disk.
5. Page 1 (and any overflow pages) render the customer block (customer, facility, address, then `Instrument:` and `Serial Number:` lines), quote number box, line-item table (List Price = catalog price, Net Price printed only when a discount applies, Ext. Price = qty × net), totals, notes, and standard bullet points, using `lib/pdf.ts` drawing helpers and the source's Quote Profile for all text/branding.
6. If the profile has terms, a new page starts the terms & conditions document: title/subtitle, then the intro paragraph and numbered sections from the profile, paginating automatically via `ensureSpace()`/`newTCPage()`.
7. `doc.end()` finalizes the PDF stream; the client receives it as a downloadable blob.

## Document Generation Pipeline (PDF Internals)

- Fixed US Letter page size (612×792pt), 36pt margins, all coordinates in points.
- A 7-column table (`TC` constants in `pdf.ts`) is drawn cell-by-cell with `cellBorder()` — there's no table library involved, every border and text cell is manually positioned.
- Page breaks are computed manually: before adding a row, the code checks whether it fits above the footer line (`FOOTER_Y`) and calls `doc.addPage()` + re-draws the header/table header if not.
- The terms & conditions renderer measures text height with `doc.heightOfString()` before drawing, to decide whether a section needs a new page.
- Colors, logo and footer are parameters taken from the source's Quote Profile per request in `quotes.ts` (`TEXT_COLOR`, `BORDER_COLOR`, `HEADER_BG`, `LOGO`, `FOOTER_LINES`) rather than being hardcoded inside `pdf.ts`.

## Workspace Package Resolution — Don't Add TS Project References to `artifacts/*`

`artifacts/api-server/tsconfig.json` and `artifacts/quoting-tool/tsconfig.json` intentionally do **not** declare a `"references"` array pointing at the `lib/*` packages they depend on (`@workspace/api-zod`, `@workspace/config`, etc.), even though those are composite TypeScript projects (`"composite": true` in their own tsconfigs). This is deliberate, not an oversight.

Each `lib/*` package's `package.json` points its `exports` field straight at TypeScript source (e.g. `"exports": { ".": "./src/index.ts" }`), so plain module resolution (`moduleResolution: "bundler"`) reads the `.ts` source directly — no build step required. But if a consuming tsconfig declares that same package under `"references"`, TypeScript switches to stricter project-reference semantics and requires the referenced package's `.d.ts` output to already exist on disk (`dist/index.d.ts`), or it fails with **`TS6305: Output file '.../dist/index.d.ts' has not been built from source file '...'`**.

Our own `pnpm run typecheck` never surfaces this, because the root script runs `tsc --build` over `lib/*` first (via the root `tsconfig.json`'s references), which writes those `dist/*.d.ts` files before the per-package `artifacts/*` typecheck runs — masking the problem. But `dist/` is gitignored, so it doesn't exist on a fresh checkout, and **any tool that type-checks or compiles `artifacts/api-server` or `artifacts/quoting-tool` in isolation will hit TS6305** the moment those tsconfigs declare project references to unbuilt `lib/*` packages.

If you add a new `lib/*` dependency to `artifacts/api-server` or `artifacts/quoting-tool`, just add it as a normal `workspace:*` dependency in `package.json` — do **not** also add it to that tsconfig's `"references"` array.

(Note: this was originally believed to be the cause of a Vercel deployment failure — it wasn't, see the next section for the real cause. It's still a real, worthwhile fix on its own: any isolated `tsc -p` run against either package would otherwise fail on a fresh checkout.)

## Deploying to Vercel — Don't Trust the "Express" Zero-Config Preset

Vercel's "Express" Application Preset does more than run the build command. *After* that build succeeds, Vercel separately walks the **TypeScript source** to auto-construct a serverless function, using its own `ts-node`-style compiler (`@vercel/node`), which force-overrides `moduleResolution` to `NodeNext` regardless of `tsconfig.json`.

This monorepo's `lib/*` packages resolve via `"exports": { ".": "./src/index.ts" }` — pointing straight at TypeScript source, which `moduleResolution: "bundler"` (used everywhere in this repo) supports but `NodeNext` does not. The result is an opaque `Error: <file>: Emit skipped` against whatever file Vercel happened to be compiling (typically `src/routes/health.ts`). It has nothing to do with that file.

**The setup (in place): never let Vercel compile our TypeScript.** The whole app deploys as one Vercel project from the repository root, configured by the root `vercel.json`:

- `buildCommand: pnpm run build:vercel` builds the static frontend (`artifacts/quoting-tool/dist/public`, used as `outputDirectory`) and the API bundles via esbuild. `build:vercel` deliberately skips `pnpm run typecheck` so a type error can't block a deploy; typechecking still runs in the regular `pnpm run build`.
- `artifacts/api-server/src/vercel.ts` re-exports the Express `app` without `.listen()`; `build.ts` bundles it to `dist/vercel.cjs` (plain CJS, `module.exports = app`).
- `api/index.js` (repo root) is a one-line shim: `module.exports = require("../artifacts/api-server/dist/vercel.cjs")`. It exists because Vercel only builds Serverless Functions from files under a top-level `api/` directory — a `functions` entry in `vercel.json` pointing anywhere else is rejected with *"The pattern ... doesn't match any Serverless Functions inside the `api` directory"*. Vercel runs `buildCommand` before it traces `api/` functions, so the required `dist/vercel.cjs` exists by then. `@vercel/node` detects the export has `.listen` (i.e. it's an Express app) and passes it the raw Node request/response, so multer uploads and the streamed PDF response behave exactly as on a normal server.
- The function needs no `includeFiles`: seed data, the Cytek logo and everything else are compiled into the bundle. `pdfkit`'s `.afm` font data is picked up automatically by Vercel's file tracer.
- `rewrites` send `/api/*` to the function (Vercel preserves the original URL, so `app.use("/api", router)` still matches) and everything else to `index.html` for the SPA router.
- `artifacts/quoting-tool/vite.config.ts` only requires `PORT` for the dev/preview server and defaults `BASE_PATH` to `/`, so `vite build` runs on Vercel with no env vars set.

`npx vercel build` from the repo root reproduces the hosted build locally and writes `.vercel/output` (gitignored) — the fastest way to debug a deploy failure. If deployment breaks with an `Emit skipped` or similar opaque TypeScript error, check that `api/index.js` still requires a pre-built `.cjs` file rather than TypeScript source.

## Known Limitations

- **Tests are server-side only.** `pnpm --filter @workspace/api-server test` (Node's built-in runner via `tsx`) covers the Cytek import, the data source provider, the lookup endpoints, the upload parser and — most importantly — golden-text regression tests for the generated PDFs (`src/routes/quotes.golden.test.ts`, fixtures in `src/routes/__fixtures__/`; regenerate deliberately with `UPDATE_GOLDEN=1`). The React form has no automated tests.
- **No persistence.** Generated quotes are not saved anywhere; there is no quote history, audit log, or way to regenerate a past quote.
- **No authentication/authorization.** Any client that can reach the API can generate quotes or look up asset/pricing data.
- **Uploaded Data Sources need `DATABASE_URL` to persist** on serverless hosts. The Data Sources page warns when storage is memory-only.
- **Workbook layout is fixed.** Uploads must use the Cytek Quoting Tool sheet/column names; a header-mapping step for arbitrary workbooks is the next step for non-Cytek sources.
- **No authentication.** Anyone with the URL can add, replace or delete data sources, including the seeded Cytek one. Add a shared secret or login before exposing the Data Sources page widely.
- **Rev6 lacks address/contact columns.** Facility code, address and contact for the 7,093 Rev6-only instruments are blank (facility defaults to the account name) until Cytek provides an export that includes them.
- **Logos live in the profile.** Uploaded as a data URL and stored with the profile; the UI previews it via `GET /api/data-sources/{id}/logo`.
- **`lib/db` is unused scaffolding.** It builds and typechecks but nothing imports it; it's a placeholder for future persistence work, not active infrastructure.
- **`artifacts/mockup-sandbox`** is a Replit-managed component preview/design tool declared in `.replit`. It is not part of the shipped product and has no `[services.production]` block — it exists purely to help iterate on UI components inside the Replit IDE.

## Recommended Future Enhancements

1. **Access control** — the Data Sources and Quote Profile pages have no login; add one before the URL circulates widely.
2. **Persist generated quotes** — wire up `lib/db`, add a `quotes` table, and record each generated quote (customer, line items, total, PDF, timestamp) for history/audit and re-download.
3. **Authentication** — gate quote generation and catalog access behind login, scoped to a company/account.
4. **Automated tests** — start with `fseUploadParser.ts` (pure functions, easy to unit test with fixture workbooks) and a snapshot/structural test of PDF generation (e.g. asserting page count and extracted text via `pdf-parse`).
5. **Unify branding assets** — extend `CompanyConfig` to also drive the on-screen Tailwind theme and browser tab title, and consider a single logo upload that's copied to both consuming locations at build time instead of maintained by hand in two places.
6. **Persistent, replaceable Data Sources** — an upload-once import (reusing `importCytek`) that stores normalized data outside the bundle (e.g. Postgres via `lib/db`), a default/selected source per company, and later a header-mapping step for non-Cytek workbooks.
