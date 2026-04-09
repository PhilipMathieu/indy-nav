import { config } from "dotenv";
config({ path: ".env.local" });
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { MountainSeed, Mountain } from "../src/lib/types";

const DATA_DIR = join(process.cwd(), "data");
const SEEDS_PATH = join(DATA_DIR, "mountains.json");
const OUTPUT_PATH = join(DATA_DIR, "closing-dates.json");
const SKIP_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const DELAY_MS = 1000; // 1 second between requests

const forceRefresh = process.argv.includes("--force");

const closingDateSchema = z.object({
  closingDate: z
    .string()
    .nullable()
    .describe(
      "The closing date for the 2025-2026 ski season in YYYY-MM-DD format, or null if not found"
    ),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe(
      "high = firm date announced, medium = tentative/conditional, low = inferred/ambiguous"
    ),
  reasoning: z
    .string()
    .describe("Brief explanation of how the date was determined"),
});

async function fetchPageContent(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; IndyNav/1.0; closing-date-research)",
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

  // Truncate to avoid token limits — 8000 chars is plenty for finding a closing date
  return text.slice(0, 8000);
}

async function extractClosingDate(
  mountain: MountainSeed,
  pageContent: string
): Promise<{ closingDate: string | null; confidence: "high" | "medium" | "low" }> {
  const { object } = await generateObject({
    model: google("gemini-3.1-flash-lite-preview"),
    schema: closingDateSchema,
    prompt: `You are extracting ski season closing date information.

Mountain: ${mountain.name} (${mountain.state})
Source URL: ${mountain.closingDateUrl}

Page content:
${pageContent}

Extract the closing date for the 2025-2026 ski season. Look for phrases like "closing day", "last day", "season ends", "final day of skiing", or specific date announcements. The season typically ends between March and May 2026.

If the page mentions the mountain is already closed for the season, still extract the closing date if mentioned.
If no closing date information is found, return null for closingDate with low confidence.`,
  });

  return {
    closingDate: object.closingDate,
    confidence: object.confidence,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("=== Indy Nav Closing Date Pipeline ===\n");

  const seeds: MountainSeed[] = JSON.parse(
    readFileSync(SEEDS_PATH, "utf-8")
  );

  // Load existing results for incremental updates
  let existing: Mountain[] = [];
  if (existsSync(OUTPUT_PATH)) {
    existing = JSON.parse(readFileSync(OUTPUT_PATH, "utf-8"));
  }
  const existingMap = new Map(existing.map((m) => [m.id, m]));

  const results: Mountain[] = [];
  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const seed of seeds) {
    // Check if we can skip this mountain (recently updated)
    const prev = existingMap.get(seed.id);
    if (
      !forceRefresh &&
      prev &&
      prev.lastUpdated &&
      Date.now() - new Date(prev.lastUpdated).getTime() < SKIP_THRESHOLD_MS
    ) {
      console.log(`⏭  ${seed.name} — skipped (updated recently)`);
      results.push(prev);
      skipped++;
      continue;
    }

    try {
      console.log(`🔍 ${seed.name} — fetching ${seed.closingDateUrl}`);
      const pageContent = await fetchPageContent(seed.closingDateUrl);

      console.log(`🤖 ${seed.name} — extracting closing date with Gemini...`);
      const { closingDate, confidence } = await extractClosingDate(
        seed,
        pageContent
      );

      const mountain: Mountain = {
        id: seed.id,
        name: seed.name,
        region: seed.region,
        state: seed.state,
        closingDate,
        closingDateSource: seed.closingDateUrl,
        closingDateConfidence: confidence,
        lastUpdated: new Date().toISOString(),
        websiteUrl: seed.websiteUrl,
      };

      results.push(mountain);
      fetched++;

      const dateStr = closingDate ?? "unknown";
      console.log(
        `✅ ${seed.name} — ${dateStr} (${confidence} confidence)\n`
      );
    } catch (error) {
      console.error(
        `❌ ${seed.name} — failed: ${error instanceof Error ? error.message : error}\n`
      );

      // Keep previous result if available, otherwise create a placeholder
      if (prev) {
        results.push(prev);
      } else {
        results.push({
          id: seed.id,
          name: seed.name,
          region: seed.region,
          state: seed.state,
          closingDate: null,
          closingDateSource: seed.closingDateUrl,
          closingDateConfidence: "low",
          lastUpdated: new Date().toISOString(),
          websiteUrl: seed.websiteUrl,
        });
      }
      failed++;
    }

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
  console.log(`Total:   ${seeds.length}`);
  console.log(`Fetched: ${fetched}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed:  ${failed}`);
  console.log(`\nResults written to ${OUTPUT_PATH}`);
}

main().catch(console.error);
