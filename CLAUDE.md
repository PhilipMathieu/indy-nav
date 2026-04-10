# CLAUDE.md

## Project Overview

Indy Nav is an unofficial closing date tracker for Indy Pass ski mountains. It helps skiers plan spring trips by showing which mountains are still open, closing soon, or already done for the season. Live at https://philipmathieu.github.io/indy-nav/.

## Architecture

Two independent subsystems:

1. **Data pipeline** (`scripts/fetch-closing-dates.ts`) — A standalone TypeScript script that fetches mountain websites, sends content to Google Gemini Flash Lite to extract closing dates, and writes structured JSON. Falls back to Google Search when scraping fails. High-confidence results are locked in and not re-checked.

2. **Web app** (`src/`) — A Next.js app (static export) that imports `data/closing-dates.json` and renders a sortable, filterable data table. No server-side logic at runtime.

## Tech Stack

- Next.js 16 (App Router, `output: "export"` for GitHub Pages)
- TypeScript
- Tailwind CSS v4 + shadcn/ui (Base UI, not Radix — `asChild` is not available)
- TanStack Table for data table logic
- Vercel AI SDK + `@ai-sdk/google` with `gemini-3.1-flash-lite-preview`
- GitHub Actions for daily pipeline runs and deployment

## Key Commands

```bash
npm run dev                                    # Start dev server
npx next build                                 # Static export to out/
npx tsx scripts/fetch-closing-dates.ts         # Run pipeline (incremental)
npx tsx scripts/fetch-closing-dates.ts --force # Re-check all mountains
```

## Important Conventions

- **shadcn/ui uses Base UI**, not Radix UI. Popover, Toggle, etc. have different APIs. Don't use `asChild` — use `buttonVariants()` className approach instead.
- **Scripts are excluded from tsconfig** (`"exclude": ["node_modules", "scripts"]`) because they use AI SDK features (`tools` on `generateObject`) that don't typecheck cleanly but work at runtime.
- **`.env.local`** holds `GOOGLE_GENERATIVE_AI_API_KEY`. Scripts load it via `dotenv` (`config({ path: ".env.local" })`), not Next.js auto-loading.
- **IBM Carbon-inspired theme** — neutral grays, minimal decoration, 14px body, subtle border radius. See `globals.css` for the full token set.
- **Data files live in `data/`**, not `src/`. `mountains.json` is hand-maintained seed data; `closing-dates.json` is pipeline-generated.
- **GitHub Actions are pinned by full SHA** with version comments. Use Node.js 24 versions (v5/v6) of all actions.
- **Static export** — the app uses `import closingDates from "../../data/closing-dates.json"`, not `readFileSync`. No Node.js APIs at runtime.

## Data Flow

```
data/mountains.json (169 seed entries with URLs)
        ↓
scripts/fetch-closing-dates.ts (Gemini extraction + Google Search fallback)
        ↓
data/closing-dates.json (enriched with dates, confidence, timestamps)
        ↓
src/app/page.tsx (imports JSON, renders table)
        ↓
out/ (static HTML via `next build`)
        ↓
GitHub Pages (deployed by Actions)
```

## Pipeline Behavior

- Skips mountains with `closingDateConfidence: "high"` (unless `--force`)
- Skips mountains updated within 24 hours (unless `--force`)
- Falls back to Google Search when website scrape returns no date
- Falls back to Google Search when website returns HTTP error (403, timeout)
- 1-second delay between requests to avoid rate limits
- Sorts output by closing date descending, nulls at end

## Deployment

- GitHub Pages at `philipmathieu.github.io/indy-nav`
- `NEXT_PUBLIC_BASE_PATH=/indy-nav` is set during CI build
- Daily GitHub Action at 6am ET runs the pipeline, commits if data changed, rebuilds Pages
- Manual trigger available via `workflow_dispatch`
- API key stored as repo secret `GOOGLE_GENERATIVE_AI_API_KEY`
