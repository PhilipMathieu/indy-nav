import { config } from "dotenv";
config({ path: ".env.local" });
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { MountainSeed } from "../src/lib/types";

const DATA_DIR = join(process.cwd(), "data");
const RAW_PATH = join(DATA_DIR, "resorts-raw.json");
const SEEDS_PATH = join(DATA_DIR, "mountains.json");
const DELAY_MS = 500;

interface RawResort {
  name: string;
  state: string;
  region: string;
  websiteUrl: string | null;
}

const resortUrlSchema = z.object({
  websiteUrl: z
    .string()
    .nullable()
    .describe("The official website URL for this ski resort, or null if not found"),
  closingDateUrl: z
    .string()
    .nullable()
    .describe("The best URL on the resort's website for finding closing date / season end information. Usually a conditions, hours, or snow report page."),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lookupResortUrl(
  resort: RawResort
): Promise<{ websiteUrl: string | null; closingDateUrl: string | null }> {
  const { object } = await generateObject({
    model: google("gemini-3.1-flash-lite-preview"),
    schema: resortUrlSchema,
    tools: {
      googleSearch: google.tools.googleSearch,
    },
    prompt: `Find the official website URL for "${resort.name}" ski resort/ski area in ${resort.state}.

Use Google Search to find the official website. Look for the resort's own domain (not aggregator sites like onthesnow.com or skicentral.com).

Also find the best page on their site for finding ski season closing dates or hours of operation. Common patterns include /conditions, /hours, /snow-report, /mountain-report, /trail-report, /hours-of-operation.

If you can't find the official website, return null.`,
  });

  return {
    websiteUrl: object.websiteUrl,
    closingDateUrl: object.closingDateUrl,
  };
}

async function main() {
  const rawResorts: RawResort[] = JSON.parse(readFileSync(RAW_PATH, "utf-8"));

  // Load existing seeds to avoid re-processing
  let existingSeeds: MountainSeed[] = [];
  if (existsSync(SEEDS_PATH)) {
    existingSeeds = JSON.parse(readFileSync(SEEDS_PATH, "utf-8"));
  }
  const existingIds = new Set(existingSeeds.map((s) => s.id));

  // Filter to only new resorts
  const newResorts = rawResorts.filter((r) => !existingIds.has(slugify(r.name)));
  console.log(
    `=== Build Seed Data ===\n` +
    `Total raw resorts: ${rawResorts.length}\n` +
    `Already in seeds: ${existingIds.size}\n` +
    `New to process: ${newResorts.length}\n`
  );

  const newSeeds: MountainSeed[] = [];
  let found = 0;
  let notFound = 0;

  for (let i = 0; i < newResorts.length; i++) {
    const resort = newResorts[i];
    const id = slugify(resort.name);

    try {
      console.log(`[${i + 1}/${newResorts.length}] ${resort.name} (${resort.state})...`);
      const { websiteUrl, closingDateUrl } = await lookupResortUrl(resort);

      if (websiteUrl) {
        const seed: MountainSeed = {
          id,
          name: resort.name,
          state: resort.state,
          region: resort.region,
          websiteUrl,
          closingDateUrl: closingDateUrl || websiteUrl,
        };
        newSeeds.push(seed);
        found++;
        console.log(`  ✅ ${websiteUrl}`);
      } else {
        console.log(`  ❌ No website found`);
        notFound++;
      }
    } catch (error) {
      console.error(
        `  ❌ Error: ${error instanceof Error ? error.message : error}`
      );
      notFound++;
    }

    await sleep(DELAY_MS);
  }

  // Merge with existing seeds
  const allSeeds = [...existingSeeds, ...newSeeds];
  allSeeds.sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name));

  writeFileSync(SEEDS_PATH, JSON.stringify(allSeeds, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`Found URLs: ${found}`);
  console.log(`Not found:  ${notFound}`);
  console.log(`Total seeds: ${allSeeds.length}`);
  console.log(`\nWritten to ${SEEDS_PATH}`);
}

main().catch(console.error);
