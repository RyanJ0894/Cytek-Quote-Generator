# Quote Magic

Quote Magic is a configurable service quoting and PDF contract generator. Field engineers look up an instrument by serial number, get customer and contract details auto-filled from an Excel data source, add parts and service line items, and generate a branded PDF quote with terms & conditions attached.

Quote Magic started as a purpose-built internal tool for Cytek Biosciences and is being generalized into a reusable, commercially licensable product. All company-specific branding, contact information, and contract language now live in a single configuration module (`lib/config`), so the same codebase can be re-branded for a new customer without touching application code.

> The Cytek Biosciences configuration shipped in this repository (`lib/config/src/companies/cytek.ts`) is an example/default tenant configuration, not a hardcoded requirement of the product.

## Features

- **Serial number lookup** — type a serial number and auto-fill account name, facility, address, contract type/status, and instrument name from the asset catalog.
- **Parts catalog search** — searchable autocomplete over the pricing catalog with auto-filled part numbers and list prices.
- **Excel import** — upload a filled-in "FSE Input" workbook and the form auto-populates from it (service quote, parts quote, or both).
- **Service + parts quoting** — mix a primary service line with any number of parts line items, with live subtotal/shipping/total calculation.
- **Branded PDF generation** — server-rendered PDF quote plus a multi-page terms & conditions document, styled from the active company configuration (logo, colors, footer, legal text).
- **Company configuration system** — swap company name, address, contact info, logo, quote footer bullets, contract language, document titles, and PDF colors from one config file, with no code changes.

## Tech Stack

- **Monorepo**: pnpm workspaces
- **Backend**: Node.js 24, Express 5, TypeScript
- **Frontend**: React 19 + Vite, Tailwind CSS, React Query, React Hook Form, Framer Motion
- **PDF generation**: [pdfkit](https://pdfkit.org/)
- **Excel parsing**: [xlsx (SheetJS)](https://www.npmjs.com/package/xlsx)
- **Validation**: Zod
- **API client codegen**: Orval, generated from an OpenAPI spec

## Installation

Requirements:
- Node.js 24
- [pnpm](https://pnpm.io/) 10+ (this repo refuses to install with npm/yarn — see `preinstall` in `package.json`)

```bash
git clone <repository-url>
cd quote-magic
pnpm install
```

## Running Locally

Quote Magic runs as two independent services: the API server and the frontend. Both read required configuration from environment variables (see below) — set them before starting either service.

```bash
# Terminal 1 — API server (default: http://localhost:8080)
PORT=8080 pnpm --filter @workspace/api-server run dev

# Terminal 2 — frontend (default: http://localhost:22515)
PORT=22515 BASE_PATH=/ pnpm --filter @workspace/quoting-tool run dev
```

Open the frontend URL in your browser. The frontend calls the API under `/api/*`; in local dev, make sure the two are proxied together or point the frontend at the API server directly if running them on separate hosts/ports.

If you change the OpenAPI spec (`lib/api-spec/openapi.yaml`), regenerate the typed API client before starting the frontend:

```bash
pnpm --filter @workspace/api-spec run codegen
```

## Environment Variables

| Variable | Required by | Description |
| --- | --- | --- |
| `PORT` | API server, frontend | Port each service listens on. The process throws on startup if unset. |
| `BASE_PATH` | frontend | Base path the frontend is served from (e.g. `/`). Required by the Vite config. |
| `COMPANY_ID` | API server, frontend | Optional. Selects which `CompanyConfig` in `lib/config/src/companies/` is active. Defaults to `cytek`, the only company configured today. |
| `NODE_ENV` | API server | Standard Node environment flag (`development` / `production`). |
| `DATABASE_URL` | `lib/db` only | Postgres connection string. Only required if you run `pnpm --filter db run push`; the shipped application does not currently read from a database. Reserved for future persistence (see [Roadmap](#future-roadmap)). |

## Build Instructions

```bash
# Type-check everything
pnpm run typecheck

# Build all packages (frontend static bundle + API server CJS bundle)
pnpm run build
```

- The frontend build (`pnpm --filter @workspace/quoting-tool run build`) outputs a static bundle to `artifacts/quoting-tool/dist/public`, servable by any static file host.
- The API server build (`pnpm --filter @workspace/api-server run build`) bundles to `artifacts/api-server/dist/index.cjs` via esbuild and is started with `node artifacts/api-server/dist/index.cjs`.

## Folder Structure

```text
quote-magic/
├── artifacts/
│   ├── api-server/              # Express API server
│   │   ├── src/data/            # quoting_data.xlsx, company logo (source data for the active company)
│   │   ├── src/lib/             # excelParser.ts, fseUploadParser.ts, pdf.ts (reusable PDF drawing helpers)
│   │   ├── src/routes/          # assets.ts, parts.ts, quotes.ts, upload.ts, health.ts
│   │   └── src/middlewares/     # reserved for future Express middleware
│   └── quoting-tool/            # React + Vite frontend
│       └── src/
│           ├── components/      # QuoteForm.tsx, ExcelUpload.tsx, Autocomplete.tsx, ui/ (design system primitives)
│           ├── pages/           # home.tsx, not-found.tsx
│           ├── hooks/
│           └── lib/             # frontend-only utilities (cn, formatCurrency)
├── lib/
│   ├── config/                  # @workspace/config — single source of truth for company/branding data
│   │   └── src/companies/       # one file per company (e.g. cytek.ts) implementing CompanyConfig
│   ├── api-spec/                # OpenAPI spec + Orval codegen config
│   ├── api-client-react/        # Generated typed React Query hooks
│   ├── api-zod/                 # Generated Zod schemas
│   └── db/                      # Drizzle ORM scaffold, not yet wired into the app (future persistence layer)
├── scripts/                     # Repo maintenance scripts
├── DEVELOPMENT_NOTES.md         # Architecture deep-dive for contributors
└── README.md
```

## Future Roadmap

- **Multi-company support**: `lib/config` already isolates all per-company data behind the `CompanyConfig` interface and an `ACTIVE_COMPANY_ID`/`COMPANY_ID` selection seam. The next step is resolving the active company per-request (e.g. by subdomain or account) instead of at process startup.
- **User accounts & authentication**: `lib/db` is scaffolded (Drizzle ORM + Postgres) but not wired up. Adding accounts would let each company manage its own users and data.
- **Persisted quote history**: quotes are currently generated and streamed directly to the browser with no server-side record. A database-backed quote history/audit trail is a natural extension once `lib/db` is active.
- **Configurable branding colors in the UI**: the PDF's colors already come from `CompanyConfig.pdfTheme`; extending that to the on-screen Tailwind theme (currently CSS custom properties in `index.css`) would let a company's brand colors drive the whole app, not just the PDF.
- **Company-specific document titles in the browser tab**: `index.html`'s `<title>` is currently static; templating it from the active `CompanyConfig` at build time would complete the white-labeling story.
- **Automated tests**: there is currently no test suite. Priority coverage would be the FSE upload parser (`fseUploadParser.ts`) and PDF line-item/total calculations, both of which are pure functions well-suited to unit testing.
