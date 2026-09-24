# Evans Quote Generator

## Overview

Evans Quote Generator is a seller-neutral service quoting and PDF contract generator. Pick a Data Source, enter a serial number, get customer/contract data auto-filled, add parts and services with discounts, and generate a PDF quote branded with that source's Quote Profile. Cytek Biosciences ships as the seeded "Cytek — Current" source with its own profile. See `DEVELOPMENT_NOTES.md` for the architecture and `README.md` for setup instructions.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Frontend**: React + Vite (Tailwind CSS, React Query, React Hook Form, Framer Motion)
- **PDF generation**: pdfkit
- **Excel parsing**: xlsx (one-time import of the Cytek workbook into `artifacts/api-server/src/data-sources/cytek/`, plus Upload Mode)
- **Validation**: Zod (`zod/v4`)
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
quote-magic/
├── artifacts/
│   ├── api-server/          # Express API server
│   │   ├── src/data/        # logo
│   │   ├── src/data-sources/ # Data Sources: cytek importer + generated assets/products JSON
│   │   ├── src/lib/         # fseUploadParser.ts, pdf.ts
│   │   └── src/routes/      # assets.ts, parts.ts, quotes.ts, upload.ts
│   └── quoting-tool/        # React + Vite frontend
│       └── src/
│           ├── components/  # QuoteForm.tsx, ExcelUpload.tsx, Autocomplete.tsx
│           └── pages/       # home.tsx
├── lib/
│   ├── api-spec/              # OpenAPI spec + Orval codegen config
│   ├── api-client-react/      # Generated React Query hooks
│   ├── api-zod/                # Generated Zod schemas
│   └── db/                     # Drizzle ORM scaffold (not wired up yet — reserved for future accounts/multi-tenancy)
└── scripts/                   # Utility scripts
```

## Key Features

- **Serial Number Lookup**: Type a serial to auto-fill account name, facility, address, contract type, contract status, and instrument name from `Asset Data` sheet (3,585 records)
- **Parts Catalog**: Searchable dropdown from `Pricing Data` sheet (5,178 parts) with auto-filled part numbers and prices
- **Service Types**: Dropdown for common service types with editable pricing
- **PDF Generation**: Professional quote PDF generated server-side with PDFKit, downloaded in browser
- **Discounts**: Per-line discount % (service and parts) with adjusted price and line total; PDF prints list, net and extended prices
- **Totals**: Live calculation of service + parts subtotals + S&H

## API Endpoints

- `GET /api/assets/serials` — All serial numbers for autocomplete
- `GET /api/assets/lookup?serial=xxx` — Asset lookup by serial
- `GET /api/parts` — Full parts catalog
- `POST /api/quotes/generate` — Generate PDF quote (returns `application/pdf`)
- `POST /api/quotes/parse-upload` — Parse an uploaded FSE Excel workbook into form data
- `GET /api/healthz` — Health check
- `GET/POST /api/data-sources`, `POST /api/data-sources/{id}/replace|default`, `DELETE /api/data-sources/{id}` — Data Source management
- Lookups accept `?dataSource=<id>`

## Data Source

Quotes are created from a saved **Data Source** (Home → pick a source → Manual Quote at `/quote/<id>`); no spreadsheet is uploaded when quoting. Sources are managed on `/data-sources` (add, set default, update file, delete) and persisted in Postgres when `DATABASE_URL` is set (or `DATA_SOURCES_DIR` locally). The shipped Cytek data is a seed saved on first start as "Cytek — Current", generated from `Cytek Quoting Tool - Rev6.xlsx` with facility/address/contact carried over from Rev5; regenerate with `pnpm --filter @workspace/api-server run import:cytek`. See `manifest.json` in `artifacts/api-server/src/data-sources/cytek/` for counts and field mappings.
- **Asset Data**: 9,635 instruments with serial, account, product, contract type/number/end date, country, status
- **Pricing Data**: 5,419 products (5,180 priced, 239 flagged as having no list price in the source; 164 services/contracts)

## Running

- Frontend: `pnpm --filter @workspace/quoting-tool run dev`
- API Server: `pnpm --filter @workspace/api-server run dev`
- Codegen: `pnpm --filter @workspace/api-spec run codegen`
