# CLAUDE.md

## Project Overview

Indy Nav is an unofficial opening and closing date tracker for Indy Pass ski mountains. It helps skiers plan trips all season by showing which mountains are open, opening soon, closing soon, or already done for the season. Live at https://philipmathieu.github.io/indy-nav/.

## Architecture

Two independent subsystems:

1. **Data pipeline** (`scripts/fetch-closing-dates.ts`) — A standalone TypeScript script that fetches mountain websites, sends content to Google Gemini Flash Lite to extract opening and closing dates for the current season, and writes structured JSON. Falls back to Google Search when scraping misses a date. High-confidence results are locked in for the season.

2. **Web app** (`src/`) — A Next.js app (static export) that imports `data/closing-dates.json` and renders an interactive map and sortable, filterable data table. No server-side logic at runtime.

## Tech Stack

- Next.js 16 (App Router, `output: "export"` for GitHub Pages)
- TypeScript
- Tailwind CSS v4 + shadcn/ui (Base UI, not Radix — `asChild` is not available)
- MapLibre GL JS with Positron basemap for the interactive resort map
- TanStack Table for data table logic
- Vercel AI SDK + `@ai-sdk/google` with `gemini-3.5-flash-lite`
- GitHub Actions for daily pipeline runs and deployment

## Key Commands

```bash
npm run dev                                    # Start dev server
npx next build                                 # Static export to out/
npx tsx scripts/fetch-resorts.ts               # Scrape resort list from indyskipass.com
npx tsx scripts/fetch-closing-dates.ts         # Run pipeline (incremental)
npx tsx scripts/fetch-closing-dates.ts --force # Re-check all mountains
npx tsx scripts/cross-check-closing-dates.ts   # Report conflicts vs OnTheSnow
npx tsx scripts/cross-check-closing-dates.ts --fix # Apply corrections
npm run test:e2e                               # Build, then run Playwright responsive tests (phone/tablet/desktop)
npx playwright test --trace off                # Re-run e2e tests against an existing out/ build
```

## Important Conventions

- **shadcn/ui uses Base UI**, not Radix UI. Popover, Toggle, etc. have different APIs. Don't use `asChild` — use `buttonVariants()` className approach instead.
- **Scripts are excluded from tsconfig** (`"exclude": ["node_modules", "scripts"]`) because they use AI SDK features (`tools` on `generateObject`) that don't typecheck cleanly but work at runtime.
- **`.env.local`** holds `GOOGLE_GENERATIVE_AI_API_KEY`. Scripts load it via `dotenv` (`config({ path: ".env.local" })`), not Next.js auto-loading.
- **IBM Carbon-inspired theme** — neutral grays, minimal decoration, 14px body, subtle border radius. See `globals.css` for the full token set.
- **Data files live in `data/`**, not `src/`. `mountains.json` is scraped from indyskipass.com (`scripts/fetch-resorts.ts`); `closing-dates.json` holds the current season and is pipeline-generated; `archive/` holds earlier seasons.
- **Seasons are never hard-coded.** Use `getSeason()` from `src/lib/season.ts` (rolls over on August 1). Every row in `closing-dates.json` carries a `season`; rows without one are 2025-26. Status (open / opening soon / closed / unknown) comes from `src/lib/status.ts`, shared by the table and map.
- **GitHub Actions are pinned by full SHA** with version comments. Use Node.js 24 versions (v5/v6) of all actions.
- **Static export** — the app uses `import closingDates from "../../data/closing-dates.json"`, not `readFileSync`. No Node.js APIs at runtime.
- **Mobile layout** — below Tailwind's `sm` breakpoint (640px) the table is replaced by a card list (`data-testid="mountain-list"`) with a "Sort by" select; filters stack and use 36px+ tap targets. Columns can carry `meta.className` for responsive visibility (e.g. Last Updated is `lg`+ only). `e2e/responsive.spec.ts` checks for horizontal overflow and layout on phone, tablet, and desktop viewports and runs on every PR (`.github/workflows/e2e.yml`).
- **Map + table shared state** — filter state (date, regions) and selection state are lifted to `page.tsx` (client component) and passed down to both `ResortMap` and `ClosingDatesTable`. The map merges lat/lon from `mountains.json` at the component level.

## Data Flow

```
data/mountains.json (scraped resort list with URLs)
        ↓
scripts/fetch-closing-dates.ts (Gemini extraction + Google Search fallback)
        ↓
scripts/cross-check-closing-dates.ts (OnTheSnow opening dates and conflicts)
        ↓
data/closing-dates.json (current season: dates, confidence, timestamps)
        ↓
src/app/page.tsx (merges JSON data, renders map + table)
        ↓
out/ (static HTML via `next build`)
        ↓
GitHub Pages (deployed by Actions)
```

## Pipeline Behavior

- Archives rows from earlier seasons to `data/archive/closing-dates-<season>.json` and re-checks those mountains
- Skips mountains whose closing date is high confidence and whose opening date is high confidence or has passed (unless `--force`)
- Re-checks other mountains every 3 days, or daily when a known date is within 14 days (unless `--force`)
- Discards extracted dates that fall outside the current season
- Falls back to Google Search for a missing opening date (until Jan 1) or closing date (from Feb 1), or when the website errors; capped at `MAX_SEARCHES_PER_RUN` (default 100)
- 1-second delay between requests to avoid rate limits
- Sorts output by closing date descending, nulls at end

## Deployment

- GitHub Pages at `philipmathieu.github.io/indy-nav`
- `NEXT_PUBLIC_BASE_PATH=/indy-nav` is set during CI build
- `.github/workflows/deploy-pages.yml` is the one reusable build-and-deploy workflow (with a `.next/cache` cache); every deploy goes through it
- `deploy.yml` deploys on pushes to main that touch the site (`src/`, `public/`, `data/`, package or Next/Tailwind config), or manually — no pipeline run, a couple of minutes. Use it to ship cosmetic changes
- Daily GitHub Action at 6am ET runs the pipeline, commits if anything in `data/` changed, then calls `deploy-pages.yml`
- Weekly GitHub Action (Mondays) refreshes `mountains.json` from indyskipass.com and deploys if it changed (bot pushes with `GITHUB_TOKEN` don't trigger `deploy.yml`); it refuses to shrink the list by more than 20% unless run with `--force`
- Both data workflows share a concurrency group so their commits to main don't collide
- Manual trigger available via `workflow_dispatch` on all three (`deploy.yml` for a site-only redeploy)
- API key stored as repo secret `GOOGLE_GENERATIVE_AI_API_KEY`
