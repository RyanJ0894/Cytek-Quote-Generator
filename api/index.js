// Vercel serverless entrypoint for the API server.
//
// Vercel only turns files under a top-level `api/` directory into Serverless
// Functions, so this shim is what Vercel actually deploys. It re-exports the
// Express app from the esbuild bundle that `pnpm run build:vercel` produces
// (see artifacts/api-server/build.ts and artifacts/api-server/src/vercel.ts).
//
// Handing Vercel an already-bundled plain-JS file is deliberate: Vercel's own
// TypeScript compilation cannot resolve this monorepo's workspace packages
// (see DEVELOPMENT_NOTES.md, "Deploying to Vercel").
//
// Requests reach this function via the `/api/(.*)` rewrite in vercel.json.
// Vercel preserves the original URL, so Express's `app.use("/api", ...)`
// routing works unchanged.
module.exports = require("../artifacts/api-server/dist/vercel.cjs");
