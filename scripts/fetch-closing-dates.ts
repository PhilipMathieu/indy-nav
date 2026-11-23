import { config } from "dotenv";
config({ path: ".env.local" });
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { MountainSeed, Mountain, Confidence } from "../src/lib/types";
import { getSeason, isInSeason, LEGACY_SEASON_LABEL } from "../src/lib/season";

const DATA_DIR = join(process.cwd(), "data");
const SEEDS_PATH = join(DATA_DIR, "mountains.json");
const OUTPUT_PATH = join(DATA_DIR, "closing-dates.json");
const ARCHIVE_DIR = join(DATA_DIR, "archive");
const DAY_MS = 24 * 60 * 60 * 1000;
// Unsettled rows are re-checked every few days, and daily once a known date is
// close, so the daily run doesn't re-read ~300 pages every morning.
const RECHECK_MS = 3 * DAY_MS;
const RECHECK_SOON_MS = 1 * DAY_MS;
const SOON_DAYS = 14;
// Scheduled runs start at slightly different times each day; without slack a
// row checked at 18:20 yesterday would be skipped by a run at 18:00 today.
const RECHECK_SLACK_MS = 4 * 60 * 60 * 1000;
const DELAY_MS = 1000; // 1 second between requests
const MODEL = "gemini-3.5-flash-lite";

// Google Search grounding is free up to a monthly allowance and billed per
// query after that. Capping searches per run keeps a full month well inside
// the allowance (100/day * 31 days < 5,000).
const MAX_SEARCHES_PER_RUN = Number(process.env.MAX_SEARCHES_PER_RUN ?? 100);

const forceRefresh = process.argv.includes("--force");

const season = getSeason();
const today = new Date().toISOString().slice(0, 10);
// After New Year almost every area is open, so a missing opening date stops
// being worth a search or a re-check.
const midSeason = `${season.endYear}-01-01`;
// Few areas announce closing dates before February, so a missing closing date
// only triggers a Google Search from then on.
const closingSearchFrom = `${season.endYear}-02-01`;

let searchesUsed = 0;

type StoredMountain = Omit<Mountain, "lat" | "lon">;

interface Finding {
  date: string | null;
  confidence: Confidence;
  reasoning: string;
  source: string;
}

interface SeasonFindings {
  opening: Finding;
  closing: Finding;
}

// ── Schema and prompts ──────────────────────────────────────────────────────

const findingSchema = (what: string) =>
  z.object({
    date: z
      .string()
      .nullable()
      .describe(`The ${what} for the ${season.label} ski season in YYYY-MM-DD format, or null if not found`),
    confidence: z
      .enum(["high", "medium", "low"])
      .describe(
        "high = firm date announced, medium = tentative/conditional (e.g. 'conditions permitting'), low = inferred/ambiguous"
      ),
    reasoning: z
      .string()
      .describe("Brief explanation of how the date was determined, quoting key phrases from the source"),
  });

const seasonDatesSchema = z.object({
  opening: findingSchema("opening date (first day of operation)"),
  closing: findingSchema("closing date (last day of operation)"),
  sourceUrl: z
    .string()
    .nullable()
    .describe(
      "The specific URL of the page or article where the date information was found, or null if not available"
    ),
});

const seasonContext = `The ${season.startYear}-${season.endYear} season runs roughly November ${season.startYear} through May ${season.endYear}. Opening dates are usually between October ${season.startYear} and January ${season.endYear}. Closing dates are usually between February and May ${season.endYear}. Ignore dates from the ${season.startYear - 1}-${season.startYear} season or earlier.`;

async function extractSeasonDates(
  mountain: MountainSeed,
  pageContent: string
): Promise<SeasonFindings> {
  const { object } = await generateObject({
    model: google(MODEL),
    schema: seasonDatesSchema,
    prompt: `You are extracting the opening and closing dates for the ${season.startYear}-${season.endYear} ski season.

Mountain: ${mountain.name} (${mountain.state})
Source URL: ${mountain.closingDateUrl}
Today's date: ${today}

Page content:
${pageContent}

Instructions for the opening date:
1. Look for explicit opening dates: "opening day December 6", "we open 12/13", "season starts Nov 28", "target opening date".
2. If the page says the mountain is open now and states when it opened, use that date.
3. If the page says it is open now but never says when it opened, return null. Do not guess today's date.
4. A target date or "conditions permitting" is medium confidence.

Instructions for the closing date:
1. Look for explicit closing dates: "closing day April 11", "last day 4/11", "season ends May 3", "open through April 19", "open daily through 3/15".
2. Look for schedule tables showing the last date with operating hours.
3. If the page says "closed for the season" or "thanks for a great season" for THIS season, look for the LAST DATE mentioned on the page (a "last updated" date, a "final report" date, or the most recent date in a schedule). That date is likely the closing date or close to it.
4. Pages often still show last season's closing message before a new season starts. Only use it if it is clearly about the ${season.label} season.

${seasonContext}

Return dates in YYYY-MM-DD format. Return null for a date only if the page has no information about it.
For reasoning, quote the key phrase(s) from the page that led to each date, e.g. 'Page says "Season ends May 3"'.
For sourceUrl, return null (the source is already known as ${mountain.closingDateUrl}).`,
  });

  return {
    opening: { ...object.opening, source: mountain.closingDateUrl },
    closing: { ...object.closing, source: mountain.closingDateUrl },
  };
}

async function searchSeasonDates(mountain: MountainSeed): Promise<SeasonFindings> {
  searchesUsed++;
  const { object } = await generateObject({
    model: google(MODEL),
    schema: seasonDatesSchema,
    tools: {
      googleSearch: google.tools.googleSearch,
    },
    prompt: `Search for the opening and closing dates of ${mountain.name} ski area in ${mountain.state} for the ${season.startYear}-${season.endYear} ski season.

Use Google Search to find when ${mountain.name} opens (or opened) and when it closes (or closed) for the ${season.label} season. Look for:
- Official announcements of opening day and closing day
- News articles about the season starting or ending
- Social media posts about the first or last day of skiing
- Forum discussions about opening or closing dates

Today's date is ${today}.
${seasonContext}

Return dates in YYYY-MM-DD format if found, otherwise null.
For sourceUrl, return the URL of the specific page or article where you found the date information.
For reasoning, quote or paraphrase the key text from that source that confirmed each date.`,
  });

  const source = object.sourceUrl ?? "google-search";
  return {
    opening: { ...object.opening, source },
    closing: { ...object.closing, source },
  };
}

// ── Fetching ────────────────────────────────────────────────────────────────

async function fetchPageContent(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; IndyNav/1.0; season-date-research)",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  const html = await response.text();

  // Strip HTML tags, scripts, styles to get text content
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Truncate to avoid token limits — 8000 chars is plenty for finding season dates
  return text.slice(0, 8000);
}

// ── Merging ─────────────────────────────────────────────────────────────────

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

const emptyFinding = (source: string): Finding => ({
  date: null,
  confidence: "low",
  reasoning: "",
  source,
});

/** Drop dates that are malformed or outside the current season. */
function sanitize(f: Finding): Finding {
  if (f.date && !isInSeason(f.date, season)) {
    return {
      ...f,
      date: null,
      confidence: "low",
      reasoning: `Discarded ${f.date}: not in the ${season.label} season. ${f.reasoning}`.trim(),
    };
  }
  return f;
}

/** Use `fallback` only when `primary` found nothing. */
function preferFound(primary: Finding, fallback: Finding): Finding {
  return primary.date ? primary : fallback.date ? fallback : primary;
}

/**
 * Combine what we knew before with today's finding.
 * - A high-confidence date is locked in.
 * - An opening date that has already passed is kept unless today's finding
 *   is a better-supported date that has also passed.
 * - Otherwise a new date replaces the old one, and a miss keeps the old one.
 */
function mergeFinding(
  prev: Finding | null,
  next: Finding,
  kind: "opening" | "closing"
): Finding {
  if (!prev?.date) return next;
  if (prev.confidence === "high") return prev;
  if (kind === "opening" && prev.date <= today) {
    const better =
      !!next.date && next.date <= today && RANK[next.confidence] > RANK[prev.confidence];
    return better ? next : prev;
  }
  return next.date ? next : prev;
}

function openingOf(row: StoredMountain): Finding | null {
  if (row.openingDate === undefined) return null;
  return {
    date: row.openingDate ?? null,
    confidence: row.openingDateConfidence ?? "low",
    reasoning: row.openingDateReasoning ?? "",
    source: row.openingDateSource ?? row.closingDateSource,
  };
}

function closingOf(row: StoredMountain): Finding {
  return {
    date: row.closingDate,
    confidence: row.closingDateConfidence,
    reasoning: row.closingDateReasoning ?? "",
    source: row.closingDateSource,
  };
}

function buildRow(seed: MountainSeed, opening: Finding, closing: Finding): StoredMountain {
  return {
    id: seed.id,
    name: seed.name,
    region: seed.region,
    state: seed.state,
    season: season.label,
    openingDate: opening.date,
    openingDateSource: opening.source,
    openingDateConfidence: opening.confidence,
    openingDateReasoning: opening.reasoning || undefined,
    closingDate: closing.date,
    closingDateSource: closing.source,
    closingDateConfidence: closing.confidence,
    closingDateReasoning: closing.reasoning || undefined,
    lastUpdated: new Date().toISOString(),
    websiteUrl: seed.websiteUrl,
  };
}

// ── Season rollover ─────────────────────────────────────────────────────────

/** Move rows from earlier seasons into data/archive/closing-dates-<season>.json. */
function archivePastSeasons(rows: StoredMountain[]): void {
  const bySeason = new Map<string, StoredMountain[]>();
  for (const row of rows) {
    const label = row.season ?? LEGACY_SEASON_LABEL;
    bySeason.set(label, [...(bySeason.get(label) ?? []), { ...row, season: label }]);
  }
  if (bySeason.size === 0) return;

  mkdirSync(ARCHIVE_DIR, { recursive: true });
  for (const [label, seasonRows] of bySeason) {
    const path = join(ARCHIVE_DIR, `closing-dates-${label}.json`);
    const archived: StoredMountain[] = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf-8"))
      : [];
    const merged = new Map(archived.map((r) => [r.id, r]));
    for (const r of seasonRows) merged.set(r.id, r);
    const out = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
    writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
    console.log(`📦 Archived ${seasonRows.length} rows from ${label} to ${path}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldSearch(f: SeasonFindings): boolean {
  if (searchesUsed >= MAX_SEARCHES_PER_RUN) return false;
  const needOpening = !f.opening.date && today < midSeason;
  const needClosing = !f.closing.date && today >= closingSearchFrom;
  return needOpening || needClosing;
}

/** How long to wait before re-checking an unsettled row. */
function recheckInterval(row: StoredMountain): number {
  const soon = new Date(Date.now() + SOON_DAYS * DAY_MS).toISOString().slice(0, 10);
  const near = (d: string | null | undefined) => !!d && d >= today && d <= soon;
  return near(row.openingDate) || near(row.closingDate) ? RECHECK_SOON_MS : RECHECK_MS;
}

async function main() {
  console.log(`=== Indy Nav Season Dates Pipeline (${season.label}) ===\n`);

  const seeds: MountainSeed[] = JSON.parse(readFileSync(SEEDS_PATH, "utf-8"));

  // Load existing results; anything from an earlier season is archived and
  // re-checked from scratch.
  let existing: StoredMountain[] = [];
  if (existsSync(OUTPUT_PATH)) {
    existing = JSON.parse(readFileSync(OUTPUT_PATH, "utf-8"));
  }
  const isCurrent = (r: StoredMountain) => (r.season ?? LEGACY_SEASON_LABEL) === season.label;
  archivePastSeasons(existing.filter((r) => !isCurrent(r)));
  const existingMap = new Map(existing.filter(isCurrent).map((m) => [m.id, m]));

  const results: StoredMountain[] = [];
  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const seed of seeds) {
    // Skip resorts with no URL to scrape
    if (!seed.websiteUrl && !seed.closingDateUrl) {
      console.log(`⏭  ${seed.name} — skipped (no URL)`);
      skipped++;
      continue;
    }

    const prev = existingMap.get(seed.id) ?? null;

    if (!forceRefresh && prev) {
      const closingLocked = !!prev.closingDate && prev.closingDateConfidence === "high";
      const openingSettled =
        today >= midSeason ||
        (!!prev.openingDate &&
          (prev.openingDateConfidence === "high" || prev.openingDate <= today));
      if (closingLocked && openingSettled) {
        console.log(
          `⏭  ${seed.name} — skipped (settled: ${prev.openingDate ?? "?"} → ${prev.closingDate})`
        );
        results.push(prev);
        skipped++;
        continue;
      }
      if (
        prev.lastUpdated &&
        Date.now() - new Date(prev.lastUpdated).getTime() < recheckInterval(prev) - RECHECK_SLACK_MS
      ) {
        console.log(`⏭  ${seed.name} — skipped (updated recently)`);
        results.push(prev);
        skipped++;
        continue;
      }
    }

    let found: SeasonFindings | null = null;

    try {
      console.log(`🔍 ${seed.name} — fetching ${seed.closingDateUrl}`);
      const pageContent = await fetchPageContent(seed.closingDateUrl);
      console.log(`🤖 ${seed.name} — extracting season dates with Gemini...`);
      const scraped = await extractSeasonDates(seed, pageContent);
      found = { opening: sanitize(scraped.opening), closing: sanitize(scraped.closing) };
    } catch (error) {
      console.error(
        `❌ ${seed.name} — scrape failed: ${error instanceof Error ? error.message : error}`
      );
    }

    // Fall back to Google Search when the scrape failed or missed a date
    const base: SeasonFindings = found ?? {
      opening: emptyFinding(seed.closingDateUrl),
      closing: emptyFinding(seed.closingDateUrl),
    };
    if (shouldSearch(base)) {
      console.log(
        `🔎 ${seed.name} — trying Google Search (${searchesUsed + 1}/${MAX_SEARCHES_PER_RUN})...`
      );
      try {
        const searched = await searchSeasonDates(seed);
        base.opening = preferFound(base.opening, sanitize(searched.opening));
        base.closing = preferFound(base.closing, sanitize(searched.closing));
        found = base;
      } catch (searchError) {
        console.log(
          `🔎 ${seed.name} — search fallback failed: ${searchError instanceof Error ? searchError.message : searchError}`
        );
      }
    }

    if (!found) {
      // Nothing worked: keep what we had, or write a placeholder
      results.push(
        prev ??
          buildRow(seed, emptyFinding(seed.closingDateUrl), emptyFinding(seed.closingDateUrl))
      );
      failed++;
      await sleep(DELAY_MS);
      continue;
    }

    const opening = mergeFinding(prev ? openingOf(prev) : null, found.opening, "opening");
    const closing = mergeFinding(prev ? closingOf(prev) : null, found.closing, "closing");
    results.push(buildRow(seed, opening, closing));
    fetched++;

    console.log(
      `✅ ${seed.name} — opens ${opening.date ?? "unknown"} (${opening.confidence}), closes ${closing.date ?? "unknown"} (${closing.confidence})\n`
    );

    await sleep(DELAY_MS);
  }

  // Sort by closing date (latest first), nulls at end
  results.sort((a, b) => {
    if (!a.closingDate && !b.closingDate) return 0;
    if (!a.closingDate) return 1;
    if (!b.closingDate) return -1;
    return b.closingDate.localeCompare(a.closingDate);
  });

  writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  console.log("=== Summary ===");
  console.log(`Season:   ${season.label}`);
  console.log(`Total:    ${seeds.length}`);
  console.log(`Fetched:  ${fetched}`);
  console.log(`Skipped:  ${skipped}`);
  console.log(`Failed:   ${failed}`);
  console.log(`Searches: ${searchesUsed}/${MAX_SEARCHES_PER_RUN}`);
  console.log(`\nResults written to ${OUTPUT_PATH}`);
}

main().catch(console.error);
