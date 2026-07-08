# Development Notes

Internal notes for engineers working on Quote Magic. For setup/run instructions, see `README.md`.

## Architecture Overview

Quote Magic is a pnpm-workspace monorepo with two deployable services and a set of shared library packages:

```
┌─────────────────────────┐        ┌──────────────────────────┐
│  quoting-tool (frontend)│  HTTP  │   api-server (backend)    │
│  React + Vite            │◄──────►│   Express 5 + TypeScript  │
│  served as static assets │  /api  │   reads xlsx, writes PDF  │
└─────────────────────────┘        └──────────────────────────┘
              │                                  │
              ▼                                  ▼
   lib/api-client-react              lib/config, artifacts/api-server/src/data
   (generated React Query hooks,          (company config, quoting_data.xlsx,
    typed from lib/api-spec)                logo)
```

- The **frontend** (`artifacts/quoting-tool`) is a static single-page app. It never talks to Excel or PDF generation directly — it calls the API server's JSON endpoints and downloads a PDF blob from `/api/quotes/generate`.
- The **backend** (`artifacts/api-server`) owns all data (the Excel catalog) and all document generation (PDFKit). It is stateless — nothing is persisted between requests.
- **`lib/config`** is imported by both services and is the single source of truth for anything company-specific: name, address, contact info, logo, contract language, quote footer bullets, document titles, and PDF colors. See "Configuration System" below.
- **`lib/api-spec` → `lib/api-zod` / `lib/api-client-react`**: the API surface is defined once in `lib/api-spec/openapi.yaml` and code-generated into a typed React Query client (`lib/api-client-react`) and Zod schemas (`lib/api-zod`). Do not hand-edit files under `src/generated/` in either package — re-run `pnpm --filter @workspace/api-spec run codegen`.
- **`lib/db`** is a Drizzle ORM + Postgres scaffold that exists but is **not currently used** by any route. It's reserved for future persistence (quote history, user accounts). See "Known Limitations".

## Major Components

### `artifacts/api-server/src/lib/excelParser.ts`
Loads and caches `src/data/quoting_data.xlsx` (a two-sheet workbook: `Asset Data` and `Pricing Data`) on first use. Exposes `getAllSerials()`, `lookupAssetBySerial()`, and `getParts()`. The workbook is parsed once and cached in module-level variables (`_workbook`, `_assets`, `_parts`) — the process must be restarted to pick up a changed data file.

### `artifacts/api-server/src/lib/fseUploadParser.ts`
Pure parsing functions for the "FSE Input" sheet of an uploaded customer-filled workbook (a different, ad hoc format from `quoting_data.xlsx`). Deliberately has no Express/HTTP dependency so it can be unit tested directly.

### `artifacts/api-server/src/lib/pdf.ts`
Company-agnostic PDFKit drawing primitives: page/column layout constants, `fmtDate`/`fmtMoney`, and functions to draw table rows, headers, totals, the page footer, and the page header (logo + date + quote number box). Every function that renders text/borders takes color values as parameters instead of hardcoding them, so it can be reused by any `CompanyConfig`.

### `artifacts/api-server/src/routes/quotes.ts`
The business logic and route handler for `POST /api/quotes/generate`. Reads the active `CompanyConfig`, assembles line items and totals from the request body, and calls into `lib/pdf.ts` to render the two-part document (quote page(s) + terms & conditions pages). This file intentionally does not know how to draw anything — it only knows what to draw and in what order.

### `artifacts/quoting-tool/src/components/QuoteForm.tsx`
The main form. Owns client-side validation (Zod + React Hook Form), live total calculation, serial-number-triggered asset lookup, and submission to `POST /api/quotes/generate` (downloading the returned PDF blob).

### `artifacts/quoting-tool/src/components/ExcelUpload.tsx`
Drag-and-drop / file-picker upload UI that posts to `POST /api/quotes/parse-upload` and hands the parsed result to `QuoteForm` to pre-populate fields.

## Configuration System

`lib/config/src/types.ts` defines `CompanyConfig` — everything the app needs to know about a company:

- `legalName`, `shortName`
- `address` (street, city/state/zip)
- `contact` (phone, fax, website, support email)
- `logo` (filename + aspect ratio)
- `quoteBullets` (footer bullet points under the quote table)
- `documentTitles` (terms & conditions title/subtitle)
- `termsAndConditions` (intro paragraph + numbered sections — the actual contract language)
- `pdfTheme` (table header background, text color, border color)

`lib/config/src/companies/cytek.ts` implements this for Cytek Biosciences, with content copied verbatim from the original hardcoded values so PDF output is byte-for-byte unchanged after the refactor. `lib/config/src/index.ts` exports `activeCompany` (selected via the `COMPANY_ID` env var, defaulting to `cytek`) and a `getFooterLines()` helper that formats the two-line PDF footer from the structured address/contact fields.

**To onboard a new company today:** add `lib/config/src/companies/<id>.ts` implementing `CompanyConfig`, register it in the `companies` map in `lib/config/src/index.ts`, drop its logo file into both `artifacts/api-server/src/data/` and `artifacts/quoting-tool/public/`, and set `COMPANY_ID=<id>` when starting both services. No other code changes needed.

`lib/config` is bundled into **both** the Node API server and the browser frontend. `process` doesn't exist in the browser, so `src/index.ts` guards its env var read with `typeof process === "undefined"` rather than accessing `process.env` directly — keep that guard if you add more environment-driven config here.

The logo image itself and the on-screen Tailwind color theme (`artifacts/quoting-tool/src/index.css`) are **not yet** driven by `CompanyConfig` — see Known Limitations.

## Quote Generation Pipeline

1. User fills out `QuoteForm` (either manually or pre-populated via Excel upload) and submits.
2. Frontend calls `POST /api/quotes/generate` with a `QuoteRequest` JSON body (customer info, serial number, service line, parts array, shipping, notes).
3. `routes/quotes.ts` validates the body is a JSON object, builds a flat `allItems` array (service line first, if present, then parts), and computes extended prices and totals.
4. A `PDFDocument` is created and piped directly to the HTTP response (`res`) — the PDF is never written to disk.
5. Page 1 (and any overflow pages) render the customer block, quote number box, line-item table, totals, notes, and standard bullet points, using `lib/pdf.ts` drawing helpers and `activeCompany` for all text/branding.
6. A new page starts the terms & conditions document: title/subtitle from `activeCompany.documentTitles`, then the intro paragraph and numbered sections from `activeCompany.termsAndConditions`, paginating automatically via `ensureSpace()`/`newTCPage()`.
7. `doc.end()` finalizes the PDF stream; the client receives it as a downloadable blob.

## Document Generation Pipeline (PDF Internals)

- Fixed US Letter page size (612×792pt), 36pt margins, all coordinates in points.
- A 7-column table (`TC` constants in `pdf.ts`) is drawn cell-by-cell with `cellBorder()` — there's no table library involved, every border and text cell is manually positioned.
- Page breaks are computed manually: before adding a row, the code checks whether it fits above the footer line (`FOOTER_Y`) and calls `doc.addPage()` + re-draws the header/table header if not.
- The terms & conditions renderer measures text height with `doc.heightOfString()` before drawing, to decide whether a section needs a new page.
- Colors, fonts, and logo are all parameters sourced from `CompanyConfig` at the top of `quotes.ts` (`TEXT_COLOR`, `BORDER_COLOR`, `HEADER_BG`, `LOGO_PATH`) rather than being hardcoded inside `pdf.ts`.

## Workspace Package Resolution — Don't Add TS Project References to `artifacts/*`

`artifacts/api-server/tsconfig.json` and `artifacts/quoting-tool/tsconfig.json` intentionally do **not** declare a `"references"` array pointing at the `lib/*` packages they depend on (`@workspace/api-zod`, `@workspace/config`, etc.), even though those are composite TypeScript projects (`"composite": true` in their own tsconfigs). This is deliberate, not an oversight.

Each `lib/*` package's `package.json` points its `exports` field straight at TypeScript source (e.g. `"exports": { ".": "./src/index.ts" }`), so plain module resolution (`moduleResolution: "bundler"`) reads the `.ts` source directly — no build step required. But if a consuming tsconfig declares that same package under `"references"`, TypeScript switches to stricter project-reference semantics and requires the referenced package's `.d.ts` output to already exist on disk (`dist/index.d.ts`), or it fails with **`TS6305: Output file '.../dist/index.d.ts' has not been built from source file '...'`**.

Our own `pnpm run typecheck` never surfaces this, because the root script runs `tsc --build` over `lib/*` first (via the root `tsconfig.json`'s references), which writes those `dist/*.d.ts` files before the per-package `artifacts/*` typecheck runs — masking the problem. But `dist/` is gitignored, so it doesn't exist on a fresh checkout, and **any tool that type-checks or compiles `artifacts/api-server` or `artifacts/quoting-tool` in isolation will hit TS6305** the moment those tsconfigs declare project references to unbuilt `lib/*` packages. This is exactly what broke a Vercel deployment scoped to `artifacts/api-server` as its Root Directory: Vercel's Node.js builder runs its own standalone `tsc` compile of that subtree (separate from our `pnpm run build`/esbuild step) and has no reason to build `lib/*` first.

If you add a new `lib/*` dependency to `artifacts/api-server` or `artifacts/quoting-tool`, just add it as a normal `workspace:*` dependency in `package.json` — do **not** also add it to that tsconfig's `"references"` array.

## Known Limitations

- **No automated tests.** Correctness currently relies on manual verification.
- **No persistence.** Generated quotes are not saved anywhere; there is no quote history, audit log, or way to regenerate a past quote.
- **Single active company per process.** `COMPANY_ID` is read once at module load — switching companies requires restarting both services, not a per-request/per-tenant decision. True multi-tenancy (e.g. resolving the company from the request's subdomain or an authenticated account) is not implemented.
- **No authentication/authorization.** Any client that can reach the API can generate quotes or look up asset/pricing data.
- **Excel data is cached in memory and read once per process.** Updating `quoting_data.xlsx` requires a server restart to take effect.
- **Logo assets are duplicated by hand.** Each company needs its logo file placed in two locations (`api-server/src/data/` for the PDF, `quoting-tool/public/` for the UI) — there's no single asset pipeline.
- **`lib/db` is unused scaffolding.** It builds and typechecks but nothing imports it; it's a placeholder for future persistence work, not active infrastructure.
- **`artifacts/mockup-sandbox`** is a Replit-managed component preview/design tool declared in `.replit`. It is not part of the shipped product and has no `[services.production]` block — it exists purely to help iterate on UI components inside the Replit IDE.
- **Pre-existing `QuoteForm.tsx` typecheck errors.** `pnpm run typecheck` currently fails on two type mismatches in `artifacts/quoting-tool/src/components/QuoteForm.tsx` (a missing `queryKey` on a generated hook's options, and a `shipping` field not present in the generated `QuoteRequest` type). Both predate this cleanup and don't affect the running app (Vite transpiles without type-checking) — the generated API client's types have drifted slightly from how the form actually calls it. Left unfixed here since `QuoteForm.tsx` is quote-generation business logic that was explicitly out of scope for this pass; worth reconciling with the OpenAPI spec in a follow-up.

## Recommended Future Enhancements

1. **Per-request company resolution** — replace the module-level `activeCompany` with a lookup keyed by subdomain, API key, or authenticated account, enabling true multi-tenant deployment from a single running process.
2. **Persist generated quotes** — wire up `lib/db`, add a `quotes` table, and record each generated quote (customer, line items, total, PDF, timestamp) for history/audit and re-download.
3. **Authentication** — gate quote generation and catalog access behind login, scoped to a company/account.
4. **Automated tests** — start with `fseUploadParser.ts` (pure functions, easy to unit test with fixture workbooks) and a snapshot/structural test of PDF generation (e.g. asserting page count and extracted text via `pdf-parse`).
5. **Unify branding assets** — extend `CompanyConfig` to also drive the on-screen Tailwind theme and browser tab title, and consider a single logo upload that's copied to both consuming locations at build time instead of maintained by hand in two places.
6. **Data refresh without restart** — add a way to reload `quoting_data.xlsx` (e.g. an admin endpoint or file-watch) instead of requiring a process restart.
