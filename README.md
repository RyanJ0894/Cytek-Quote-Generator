# Evans Quote Generator

Evans Quote Generator is a service quoting and PDF contract generator. Pick a Data Source, look up an instrument by serial number, get customer and contract details auto-filled, add parts and service line items with discounts, and generate a PDF quote branded with that source's own seller identity, with terms & conditions attached.

The application itself is seller-neutral. Each **Data Source** is one company's or dataset's Source of Truth (assets, products, prices) and carries its own **Quote Profile** (company name, logo, address, contact details, document notes, terms, colors). Cytek Biosciences ships as the seeded "Cytek — Current" source with its original branding; any other source starts with no branding and is set up on the Data Sources page. Nothing Cytek-specific is hardcoded into the application.

## Features

- **Serial number lookup** — type a serial number and auto-fill account name, facility, address, contract type/status, and instrument name from the asset catalog.
- **Parts catalog search** — searchable autocomplete over the pricing catalog with auto-filled part numbers and list prices.
- **Data Sources** — upload a company's workbook once; it becomes a persistent, isolated Source of Truth that quotes are created from. Add, update, replace, set default or delete sources without code changes.
- **Service + parts quoting** — mix a primary service line with any number of parts line items, each with an optional quote-specific discount %, with live adjusted price, line total, subtotal, shipping and total calculation.
- **Branded PDF generation** — server-rendered PDF quote (customer block with instrument and serial number, list/net/extended price columns) plus a multi-page terms & conditions document, styled from the active company configuration (logo, colors, footer, legal text).
- **Quote Profiles** — each Data Source has its own seller identity: company name, logo, address, contact info, notes under the line items, terms & conditions and PDF colors, edited in the app. Documents from a source are branded only by that source's profile; a source without a complete profile cannot generate documents. Completing the profile is the second step of adding a source (Import Workbook → Complete Quote Profile → Data Source Ready → Create Quote); an incomplete source asks to finish setup before quoting, and Manual Quote shows the warning at the top of the page.
- **Any properly laid-out workbook** — column headers are matched flexibly ("Serial #", "Customer", separate State/Zip, …) and pricing rows are classified as services, parts or instruments by an explicit Category column, sale unit or name, so a non-Cytek workbook's serials, services and parts appear in the right Manual Quote controls. Each selector lists the active source only.
- **Source management** — every homepage card has a ⋯ menu (Create Quote, Edit Data Source, Edit Quote Profile, Update Source Workbook, Delete Data Source). Edit Data Source (`/data-sources/<id>`) shows the name (renamable), workbook, counts, last update, Quote Profile and logo, workbook replacement and deletion. The Data Sources page remains the full management center; both operate on the same records. Deleting always asks for confirmation.
- **Light / Dark Mode** — a sun/moon toggle in the header switches the application theme. Dark Mode is the default; the choice is saved in the browser (`localStorage`) and respected on every later visit. The header shows the Evans logo variant made for each background. The theme styles the app only: generated PDFs are branded by the Data Source's Quote Profile and never change with it.

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

Evans Quote Generator runs as two independent services: the API server and the frontend. Both read required configuration from environment variables (see below) — set them before starting either service.

```bash
# Terminal 1 — API server (default: http://localhost:8080)
PORT=8080 pnpm --filter @workspace/api-server run dev

# Terminal 2 — frontend (default: http://localhost:22515)
PORT=22515 BASE_PATH=/ pnpm --filter @workspace/quoting-tool run dev
```

Open the frontend URL in your browser. The frontend calls the API under `/api/*`; in local dev, make sure the two are proxied together or point the frontend at the API server directly if running them on separate hosts/ports. Set `DATA_SOURCES_DIR=./.data-sources` for the API server so sources you add locally persist.

If you change the OpenAPI spec (`lib/api-spec/openapi.yaml`), regenerate the typed API client before starting the frontend:

```bash
pnpm --filter @workspace/api-spec run codegen
```

## Environment Variables

| Variable | Required by | Description |
| --- | --- | --- |
| `PORT` | API server, frontend | Port each service listens on. The process throws on startup if unset. |
| `BASE_PATH` | frontend | Base path the frontend is served from (e.g. `/`). Required by the Vite config. |
| `NODE_ENV` | API server | Standard Node environment flag (`development` / `production`). |
| `DATABASE_URL` | API server | Optional. Postgres connection string used to persist uploaded Data Sources. Without it, uploads survive only until the server restarts. |
| `DATA_SOURCES_DIR` | API server | Optional (local/dev). Directory for file-based Data Source storage when no database is configured. |

## Build Instructions

```bash
# Type-check everything
pnpm run typecheck

# Build all packages (frontend static bundle + API server CJS bundle)
pnpm run build
```

- The frontend build (`pnpm --filter @workspace/quoting-tool run build`) outputs a static bundle to `artifacts/quoting-tool/dist/public`, servable by any static file host.
- The API server build (`pnpm --filter @workspace/api-server run build`) produces **two** bundles via esbuild:
  - `artifacts/api-server/dist/index.cjs` — a self-starting server (`app.listen()`), used by Replit and any host that runs a persistent Node process: `node artifacts/api-server/dist/index.cjs`.
  - `artifacts/api-server/dist/vercel.cjs` — exports the Express app directly (no `.listen()`), for platforms that run the app as a serverless function. On Vercel it is loaded by the root `api/index.js` shim (see `vercel.json` and "Deploying to Vercel" below).

### Deploying to Vercel

The repo is set up to deploy as **one Vercel project** that serves both the frontend and the API from the same domain (`/` → static React app, `/api/*` → Express running as a Serverless Function). Configuration lives in the root `vercel.json`.

1. In Vercel, **Import** the GitHub repository (`RyanJ0894/Cytek-Quote-Generator`).
2. Leave **Root Directory** as the repository root (do **not** set it to `artifacts/api-server` — an older setup did this and no longer applies). Framework Preset should show "Other".
3. Leave Build Command, Output Directory and Install Command on their defaults — `vercel.json` overrides them (`pnpm run build:vercel`, `artifacts/quoting-tool/dist/public`, `pnpm install`).
4. No environment variables are required to run; add `DATABASE_URL` so Data Sources and Quote Profiles persist (see Persistence below).
5. Deploy. Every push to the production branch redeploys automatically.

How it works: `pnpm run build:vercel` builds the static frontend and the API bundle (`artifacts/api-server/dist/vercel.cjs`). `api/index.js` is a one-line shim that re-exports that pre-built Express app, because Vercel only creates functions from files under `api/`. `vercel.json` includes `artifacts/api-server/src/data/**` (the company logo) in the function bundle; the asset/pricing data is compiled into the API bundle itself and rewrites `/api/*` to it. Do **not** rely on Vercel's "Express" framework preset / zero-config TypeScript compilation — it cannot resolve this monorepo's workspace packages (see `DEVELOPMENT_NOTES.md`).

You can reproduce the exact Vercel build locally with `npx vercel build` from the repo root (output lands in `.vercel/output`, which is gitignored).

Vercel-specific limits to be aware of: request bodies are capped at 4.5 MB (the FSE upload form allows up to 20 MB elsewhere), and the function has a 30 s `maxDuration`.

## How quoting works: Data Source first

The product model is simple: **upload your Source of Truth once, maintain it occasionally, create quotes from it indefinitely.**

- **Home → Create a Quote** lists the saved Data Sources. Picking one opens Manual Quote for that source. There is no spreadsheet upload on the quoting path.
- **Manual Quote** (`/quote/<source id>`) searches only the selected source: serial number → account, facility, address, contract, instrument; part number or name → description, part number, list price; service/work type → price. Everything populated stays editable, with per-line discounts; edits never touch the source. A compact "Data Source: …" indicator (a dropdown when more than one exists) shows what is active; switching with a quote in progress asks for confirmation and starts a new quote, so two sources are never mixed.
- **Data Sources** (header link, `/data-sources`) is the only place workbooks are uploaded: add a source (name + workbook), set the default, update its workbook, delete it, see counts and the last update, and edit its **Quote Profile** (`/data-sources/<id>/profile`). With zero sources the home page shows an onboarding card that leads here.

Each Data Source is one persistent, isolated dataset normalized from a workbook with `Asset Data` and `Pricing Data` sheets (today: the Cytek Quoting Tool layout), plus a Quote Profile stored separately so updating the workbook never touches the branding. The Cytek data shipped with the app is a **seed**: on first start it is saved into the store as "Cytek — Current" together with the Cytek Quote Profile, and from then on it is an ordinary source (update, replace or delete it like any other; a deleted seed does not come back). Regenerate the seed data for fresh installations with `pnpm --filter @workspace/api-server run import:cytek`.

Products the workbook has no usable list price for are imported and flagged; they appear in search marked "no list price" and the form asks for a price. Prices are never invented.

### Persistence (`DATABASE_URL`) — required in production

Without a database the API keeps Data Sources in the memory of the server process. On Vercel that is worse than "lost on restart": each serverless function instance has its own memory, so a source uploaded through one instance is unknown to the others and lookups fail with "Unknown data source". The Data Sources page shows a yellow warning until a database is connected.

**One-time setup on Vercel:**

1. Vercel dashboard → the project → **Storage** → **Create Database** → **Neon** (Postgres) → connect it to this project with **Production** (and Preview) selected.
2. Vercel writes the connection variables into the project (`DATABASE_URL`, `POSTGRES_URL`, `DATABASE_URL_UNPOOLED`, …, or prefixed versions such as `STORAGE_DATABASE_URL` if a prefix was chosen; the app accepts all of these and the `PGHOST/PGUSER/PGPASSWORD/PGDATABASE` set). Confirm under **Settings → Environment Variables** that they exist for **Production**.
3. **Redeploy.** Environment variables reach only deployments created after they were added: Deployments → ⋯ on the latest deployment → **Redeploy**. Connecting the database does not redeploy by itself.
4. Open the app → Data Sources. The yellow warning is gone and the header says "Saved in Postgres · survives restarts and redeploys". Tables are created automatically on first use.

If the warning is still there after a redeploy, it now says exactly which database-related variables the running deployment can see (names only). "No database variables at all" means the database is not connected to the environment you are looking at (or the deployment predates the connection); variables present but no `postgres://` URL means a value needs fixing. A connection failure (wrong password, TLS, unreachable host) is shown as a red "Database connection failed" box with the driver's message.

Any other Postgres works the same way: set `DATABASE_URL` to its connection string (hosted databases are contacted over TLS automatically).

Sources are stored in Postgres when `DATABASE_URL` is set (tables are created automatically on first use). Locally, `DATA_SOURCES_DIR=<folder>` stores them as JSON files instead. With neither, the app still runs (the seed is re-created on every start) but anything added or changed is lost on restart, and the Data Sources page says so. On Vercel, add a Postgres database (Marketplace → Neon, or any Postgres) and set `DATABASE_URL` in the project's environment variables, then redeploy.

The API: `GET /api/data-sources`, `POST /api/data-sources` (multipart `name` + `file`), `POST /api/data-sources/{id}/replace`, `POST /api/data-sources/{id}/default`, `DELETE /api/data-sources/{id}`; lookups take `?dataSource=<id>`.

## Folder Structure

```text
quote-magic/
├── artifacts/
│   ├── api-server/              # Express API server
│   │   ├── src/data-sources/    # Data Sources: normalized data + Quote Profiles behind quoting (see above)
│   │   │   ├── quote-profile.ts # seller identity model, validation, completeness, PDF footer lines
│   │   │   └── cytek/           # seed: source workbooks, generated data JSON, Cytek Quote Profile + logo
│   │   ├── src/lib/             # fseUploadParser.ts, pdf.ts (reusable PDF drawing helpers)
│   │   ├── src/routes/          # assets.ts, parts.ts, quotes.ts, upload.ts, health.ts
│   │   └── src/middlewares/     # reserved for future Express middleware
│   └── quoting-tool/            # React + Vite frontend
│       └── src/
│           ├── components/      # QuoteForm.tsx, ExcelUpload.tsx, Autocomplete.tsx, ui/ (toast + tooltip primitives)
│           ├── pages/           # home.tsx, not-found.tsx
│           ├── hooks/
│           └── lib/             # frontend-only utilities (cn, formatCurrency)
├── lib/
│   ├── api-spec/                # OpenAPI spec + Orval codegen config
│   ├── api-client-react/        # Generated typed React Query hooks
│   ├── api-zod/                 # Generated Zod schemas
│   └── db/                      # Drizzle ORM scaffold, not yet wired into the app (future persistence layer)
├── scripts/                     # Repo maintenance scripts
├── DEVELOPMENT_NOTES.md         # Architecture deep-dive for contributors
└── README.md
```

## Future Roadmap

- **Header mapping for other workbook layouts**: today an uploaded workbook must use the Cytek Quoting Tool sheet and column names (`readSheet` in `workbook-importer.ts` already resolves each field through a list of accepted header aliases). The cleanest next step is a one-time "detected column → app field" mapping saved with the Data Source, so any company's spreadsheet can become a Source of Truth without code changes.
- **Access control**: the Data Sources and Quote Profile pages have no login.
- **Automated frontend tests**: the React app is exercised only by a browser script during development.
