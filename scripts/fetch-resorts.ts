/**
 * Scrapes the Indy Pass resort directory to generate data/mountains.json.
 *
 * Usage:
 *   npx tsx scripts/fetch-resorts.ts          # Refuses to shrink the list by >20%
 *   npx tsx scripts/fetch-resorts.ts --force  # Write whatever was scraped
 *
 * Phase 1 — listing page: fetches https://www.indyskipass.com/our-resorts and
 *   parses every resort card to extract slug, name, location string,
 *   coordinates, and nordic/alpine/xc flags.
 *
 * Phase 2 — detail pages: fetches each resort's individual page to extract the
 *   resort website URL, quick-links (conditions, webcams, etc.) and the size
 *   figures it lists (vertical, acres, trails, lifts, snowfall, XC km).
 *
 * Writes the merged result to data/mountains.json, sorted alphabetically by name.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { ResortStats } from "../src/lib/types";
import { parseLocation, type ParsedLocation } from "./parse-location";

const BASE = "https://www.indyskipass.com";
const LISTING_URL = `${BASE}/our-resorts`;
const OUTPUT_PATH = join(process.cwd(), "data", "mountains.json");
const DELAY_MS = 1000;
const CONCURRENCY = 5;
// Refuse to write a list much shorter than the current one: a redesign of
// the Indy Pass site would otherwise silently wipe most resorts.
const MIN_KEEP_RATIO = 0.8;
const forceWrite = process.argv.includes("--force");

// Region slugs used as nav categories — not actual resorts
const REGION_SLUGS = new Set([
  "west",
  "rockies",
  "midwest",
  "east",
  "mid-atlantic",
  "canada",
  "japan",
  "south-america",
  "europe",
]);

// ── Types ──────────────────────────────────────────────────────────────────

interface ResortCard {
  id: string;
  name: string;
  location: string;
  lat: number | null;
  lon: number | null;
  isNordic: boolean;
  isAlpineXc: boolean;
  isXcOnly: boolean;
  isAllied: boolean;
}

interface ResortDetail {
  websiteUrl: string | null;
  conditionsUrl: string | null;
  webcamUrl: string | null;
  stats: ResortStats | null;
}

interface MountainSeed {
  id: string;
  name: string;
  state: string;
  region: string;
  lat: number | null;
  lon: number | null;
  isNordic: boolean;
  isAlpineXc: boolean;
  isXcOnly: boolean;
  isAllied: boolean;
  websiteUrl: string;
  closingDateUrl: string;
  stats?: ResortStats;
}

// ── Phase 1: parse listing page ────────────────────────────────────────────

async function fetchListingPage(): Promise<ResortCard[]> {
  console.log(`Fetching listing page: ${LISTING_URL}`);
  const res = await fetch(LISTING_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; IndyNav/1.0; resort-list-scraper)",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Listing page returned HTTP ${res.status}`);
  const html = await res.text();

  const cards: ResortCard[] = [];

  // Each resort card is an <a> with class containing "node--type-resort"
  const cardRegex =
    /<a\s+[^>]*class="[^"]*node--type-resort[^"]*"[^>]*>/g;
  let match: RegExpExecArray | null;

  while ((match = cardRegex.exec(html)) !== null) {
    const tag = match[0];

    // Extract slug from href
    const hrefMatch = tag.match(/href="\/our-resorts\/([^"]+)"/);
    if (!hrefMatch) continue;
    const slug = hrefMatch[1];
    if (REGION_SLUGS.has(slug)) continue;

    // Extract data attributes
    const locMatch = tag.match(
      /data-location="POINT \(([^ ]+) ([^)]+)\)"/
    );
    const lat = locMatch ? parseFloat(locMatch[2]) : null;
    const lon = locMatch ? parseFloat(locMatch[1]) : null;

    const isNordic = tag.includes('data-isnordic="true"');
    const isAlpineXc = tag.includes('data-isalpinexc="true"');
    const isXcOnly = tag.includes('data-isxconly="true"');
    const isAllied = tag.includes('data-isallied="true"');

    // Extract name and location from card body (follows the <a> tag)
    const cardStart = match.index + match[0].length;
    const section = html.slice(cardStart, cardStart + 8000);

    const nameMatch = section.match(
      /<span class="label">([^<]+)<\/span>/
    );
    const locationMatch = section.match(
      /class="[^"]*location[^"]*">([^<]+)<\/span>/
    );

    const name = nameMatch
      ? decodeEntities(nameMatch[1].trim())
      : slugToName(slug);
    const location = locationMatch
      ? decodeEntities(locationMatch[1].trim())
      : "";

    cards.push({
      id: slug,
      name,
      location,
      lat,
      lon,
      isNordic,
      isAlpineXc,
      isXcOnly,
      isAllied,
    });
  }

  console.log(`Found ${cards.length} resorts on listing page`);
  return cards;
}

// ── Phase 1b: region pages ─────────────────────────────────────────────────

/** indyskipass.com/our-resorts/<slug> lists the resorts in each region. */
const REGION_PAGES: Record<string, string> = {
  west: "West",
  rockies: "Rockies",
  midwest: "Midwest",
  east: "East",
  "mid-atlantic": "Mid-Atlantic",
  canada: "Canada",
  japan: "Japan",
  europe: "Europe",
};

/** Map resort slug → Indy Pass region, from the region listing pages. */
async function fetchRegionMap(): Promise<Map<string, string>> {
  const regionMap = new Map<string, string>();
  for (const [slug, region] of Object.entries(REGION_PAGES)) {
    try {
      const res = await fetch(`${LISTING_URL}/${slug}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; IndyNav/1.0; resort-list-scraper)",
        },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const cardRegex = /<a\s+[^>]*class="[^"]*node--type-resort[^"]*"[^>]*href="\/our-resorts\/([^"]+)"/g;
      let count = 0;
      for (const m of html.matchAll(cardRegex)) {
        if (REGION_SLUGS.has(m[1])) continue;
        regionMap.set(m[1], region);
        count++;
      }
      console.log(`  Region ${region}: ${count} resorts`);
    } catch (err) {
      console.warn(`  Region page ${slug} failed (${err}); falling back to location text`);
    }
    await delay(DELAY_MS);
  }
  return regionMap;
}

/** Cards whose location line is missing or names no place. */
const LOCATION_OVERRIDES: Record<string, ParsedLocation> = {
  wisp: { state: "MD", country: "USA" }, // McHenry, MD
  "domaine-skiable-des-contamines": { state: "France", country: "France" },
  "portes-du-soleil": { state: "France", country: "France" }, // "French Swiss Border"
};

// ── Phase 2: fetch detail pages ────────────────────────────────────────────

async function fetchDetailPage(slug: string): Promise<ResortDetail> {
  const url = `${BASE}/our-resorts/${slug}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; IndyNav/1.0; resort-detail-scraper)",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    console.warn(`  ⚠ ${slug}: HTTP ${res.status}`);
    return { websiteUrl: null, conditionsUrl: null, webcamUrl: null, stats: null };
  }
  const html = await res.text();

  // Resort website: <a class="button-inverted" href="..." target="_blank">Resort Website</a>
  const websiteMatch = html.match(
    /<a[^>]*class="button-inverted"[^>]*href="([^"]+)"[^>]*>\s*Resort Website\s*<\/a>/
  );

  // Quick links
  const conditionsMatch = html.match(
    /<a[^>]*class="links_link"[^>]*href="([^"]+)"[^>]*>\s*Conditions\s*<\/a>/
  );
  const webcamMatch = html.match(
    /<a[^>]*class="links_link"[^>]*href="([^"]+)"[^>]*>\s*Webcams?\s*<\/a>/
  );

  return {
    websiteUrl: websiteMatch ? websiteMatch[1] : null,
    conditionsUrl: conditionsMatch ? conditionsMatch[1] : null,
    webcamUrl: webcamMatch ? webcamMatch[1] : null,
    stats: parseStats(html),
  };
}

/** Text of a Drupal field, e.g. `<div class="field field--name-field-acres ...">2325</div>`. */
function fieldText(html: string, field: string): string | null {
  const match = html.match(
    new RegExp(`field--name-field-${field}\\s[^>]*>\\s*([^<]*?)\\s*<`)
  );
  return match && match[1] ? match[1] : null;
}

/** Leading integer of a value such as "2325", "25km" or "1,851ft". */
function toInt(text: string | null): number | null {
  const match = text?.replace(/,/g, "").match(/^-?\d+/);
  return match ? parseInt(match[0], 10) : null;
}

function toBool(text: string | null): boolean | null {
  if (text === "Yes") return true;
  if (text === "No") return false;
  return null;
}

/**
 * Size figures from a detail page. Elevations sit in tags like
 * `elevation__tag--vertical">Vertical: 1851ft`, snowfall under the
 * "Average" chart label, and the rest in Drupal fields. A zero is treated
 * as missing, since no resort really has 0 ft of vertical or 0 lifts.
 */
function parseStats(html: string): ResortStats | null {
  const elevation = (kind: string) =>
    toInt(
      html.match(new RegExp(`elevation__tag--${kind}">[^:<]*:\\s*([\\d,]+)`))?.[1] ?? null
    );
  const snowfall = html.match(
    /class="label average">\s*Average\s*<span[^>]*>\s*([\d,]+)\s*in/
  );
  const positive = (n: number | null) => (n != null && n > 0 ? n : null);

  const stats: ResortStats = {
    verticalFt: positive(elevation("vertical")),
    summitFt: positive(elevation("summit")),
    baseFt: positive(elevation("base")),
    acres: positive(toInt(fieldText(html, "acres"))),
    trails: positive(toInt(fieldText(html, "trails"))),
    lifts: positive(toInt(fieldText(html, "lifts"))),
    snowfallIn: positive(toInt(snowfall?.[1] ?? null)),
    terrainPark: toBool(fieldText(html, "terrain-parks")),
    nightSkiing: toBool(fieldText(html, "night-skiing")),
    xcTrails: positive(toInt(fieldText(html, "trails-xc"))),
    xcKm: positive(toInt(fieldText(html, "trail-length"))),
  };
  return Object.values(stats).some((v) => v != null) ? stats : null;
}

async function fetchAllDetails(
  cards: ResortCard[]
): Promise<Map<string, ResortDetail>> {
  const details = new Map<string, ResortDetail>();

  // Process in batches with concurrency limit
  for (let i = 0; i < cards.length; i += CONCURRENCY) {
    const batch = cards.slice(i, i + CONCURRENCY);
    const batchNum = Math.floor(i / CONCURRENCY) + 1;
    const totalBatches = Math.ceil(cards.length / CONCURRENCY);
    console.log(
      `Fetching detail pages: batch ${batchNum}/${totalBatches} (${batch.map((c) => c.id).join(", ")})`
    );

    const results = await Promise.all(
      batch.map((card) => fetchDetailPage(card.id))
    );
    for (let j = 0; j < batch.length; j++) {
      details.set(batch[j].id, results[j]);
    }

    // Rate-limit between batches
    if (i + CONCURRENCY < cards.length) {
      await delay(DELAY_MS);
    }
  }

  return details;
}

// ── Merge & write ──────────────────────────────────────────────────────────

// US state → Indy Pass region. Only a fallback: the region pages on
// indyskipass.com are authoritative (see fetchRegionMap).
const US_REGIONS: Record<string, string> = {
  WA: "West", OR: "West", CA: "West", AK: "West", HI: "West", NV: "West",
  MT: "Rockies", ID: "Rockies", WY: "Rockies", CO: "Rockies", UT: "Rockies",
  NM: "Rockies", AZ: "Rockies", SD: "Rockies", ND: "Rockies",
  MN: "Midwest", WI: "Midwest", MI: "Midwest", IL: "Midwest", IA: "Midwest",
  MO: "Midwest", IN: "Midwest", OH: "Midwest", NE: "Midwest", KS: "Midwest",
  ME: "East", NH: "East", VT: "East", MA: "East", CT: "East", RI: "East",
  NY: "East", NJ: "East",
  PA: "Mid-Atlantic", MD: "Mid-Atlantic", DE: "Mid-Atlantic", VA: "Mid-Atlantic",
  WV: "Mid-Atlantic", NC: "Mid-Atlantic", SC: "Mid-Atlantic", GA: "Mid-Atlantic",
  TN: "Mid-Atlantic", KY: "Mid-Atlantic", AL: "Mid-Atlantic",
};

const SOUTH_AMERICA = new Set(["Chile", "Argentina"]);

/** Region for a parsed location, used when a resort is on no region page. */
function regionFromLocation({ state, country }: ParsedLocation): string {
  if (country === "USA") return US_REGIONS[state] ?? "";
  if (country === "Canada" || country === "Japan") return country;
  if (SOUTH_AMERICA.has(country)) return "South America";
  return country ? "Europe" : "";
}

function deriveStateAndRegion(
  card: ResortCard,
  regionMap: Map<string, string>
): { state: string; region: string } {
  const parsed = LOCATION_OVERRIDES[card.id] ?? parseLocation(card.location);
  // Indy Pass lists Chile under "West"; keep it in its own region here.
  const region = SOUTH_AMERICA.has(parsed.country)
    ? "South America"
    : regionMap.get(card.id) ?? regionFromLocation(parsed);
  if (!parsed.state) console.warn(`  No state for ${card.id}: "${card.location}"`);
  if (!region) console.warn(`  No region for ${card.id}: "${card.location}"`);
  return { state: parsed.state, region };
}

function buildMountainSeeds(
  cards: ResortCard[],
  details: Map<string, ResortDetail>,
  regionMap: Map<string, string>
): MountainSeed[] {
  return cards
    .map((card) => {
      const detail = details.get(card.id) || {
        websiteUrl: null,
        conditionsUrl: null,
        webcamUrl: null,
        stats: null,
      };
      const { state, region } = deriveStateAndRegion(card, regionMap);
      const websiteUrl = detail.websiteUrl || "";

      return {
        id: card.id,
        name: card.name,
        state,
        region,
        lat: card.lat,
        lon: card.lon,
        isNordic: card.isNordic,
        isAlpineXc: card.isAlpineXc,
        isXcOnly: card.isXcOnly,
        isAllied: card.isAllied,
        websiteUrl,
        closingDateUrl: detail.conditionsUrl || websiteUrl,
        ...(detail.stats ? { stats: detail.stats } : {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Helpers ────────────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'");
}

function slugToName(slug: string): string {
  return slug
    .replace(/-\d+$/, "") // remove trailing Drupal suffix like -0
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const cards = await fetchListingPage();
  const details = await fetchAllDetails(cards);

  const regionMap = await fetchRegionMap();
  const seeds = buildMountainSeeds(cards, details, regionMap);

  if (existsSync(OUTPUT_PATH)) {
    const previous: MountainSeed[] = JSON.parse(readFileSync(OUTPUT_PATH, "utf-8"));
    const prevIds = new Set(previous.map((s) => s.id));
    const newIds = new Set(seeds.map((s) => s.id));
    const added = seeds.filter((s) => !prevIds.has(s.id)).map((s) => s.name);
    const removed = previous.filter((s) => !newIds.has(s.id)).map((s) => s.name);
    console.log(`\nAdded (${added.length}): ${added.join(", ") || "none"}`);
    console.log(`Removed (${removed.length}): ${removed.join(", ") || "none"}`);

    if (!forceWrite && seeds.length < previous.length * MIN_KEEP_RATIO) {
      throw new Error(
        `Scraped ${seeds.length} resorts, fewer than ${Math.round(MIN_KEEP_RATIO * 100)}% of the current ${previous.length}. ` +
          "The listing page may have changed; not writing. Re-run with --force to override."
      );
    }
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(seeds, null, 2) + "\n");

  const withWebsite = seeds.filter((s) => s.websiteUrl).length;
  const withConditions = seeds.filter(
    (s) => s.closingDateUrl && s.closingDateUrl !== s.websiteUrl
  ).length;

  console.log(`\nWrote ${seeds.length} resorts to ${OUTPUT_PATH}`);
  console.log(`  ${withWebsite} have a website URL`);
  console.log(`  ${withConditions} have a dedicated conditions URL`);
  console.log(`  ${seeds.filter((s) => s.stats?.verticalFt).length} have a vertical drop`);
  console.log(`  ${seeds.filter((s) => s.stats?.acres).length} have skiable acres`);

  // Summarize by region
  const byRegion = new Map<string, number>();
  for (const s of seeds) {
    byRegion.set(s.region || "(unknown)", (byRegion.get(s.region || "(unknown)") || 0) + 1);
  }
  console.log("\nBy region:");
  for (const [region, count] of [...byRegion.entries()].sort()) {
    console.log(`  ${region}: ${count}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
