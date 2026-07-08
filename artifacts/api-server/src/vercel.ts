// Vercel-specific entrypoint: exports the Express app directly (no
// app.listen()) so it can run as a Vercel Function. Never imported by the
// normal server bootstrap (src/index.ts) — see vercel.json, which points at
// the pre-built dist/vercel.cjs produced from this file, not at TypeScript
// source. That's deliberate: Vercel's automatic TypeScript compilation for
// its Express framework preset does not correctly resolve this monorepo's
// workspace packages (see DEVELOPMENT_NOTES.md), so we bypass it entirely by
// giving Vercel an already-built plain-JS function instead.
export { default } from "./app.js";
