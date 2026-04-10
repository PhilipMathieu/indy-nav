/**
 * Scrapes the Indy Pass resort directory to generate data/mountains.json.
 *
 * Usage:
 *   npx tsx scripts/fetch-resorts.ts
 *
 * Phase 1 — listing page: fetches https://www.indyskipass.com/our-resorts and
 *   parses every resort card to extract slug, name, location string,
 *   coordinates, and nordic/alpine/xc flags.
 *
 * Phase 2 — detail pages: fetches each resort's individual page to extract the
 *   resort website URL and quick-links (conditions, webcams, etc.).
 *
 * Writes the merged result to data/mountains.json, sorted alphabetically by name.
 */

import { writeFileSync } from "fs";
import { join } from "path";

const BASE = "https://www.indyskipass.com";
const LISTING_URL = `${BASE}/our-resorts`;
const OUTPUT_PATH = join(process.cwd(), "data", "mountains.json");
const DELAY_MS = 1000;
const CONCURRENCY = 5;

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
    return { websiteUrl: null, conditionsUrl: null, webcamUrl: null };
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
  };
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

function deriveStateAndRegion(location: string): {
  state: string;
  region: string;
} {
  // Location format varies:
  //   "City, ST, USA"  |  "City, ST"  |  "City, Province, Canada"  |  "City, Country"
  const parts = location.split(",").map((s) => s.trim());

  if (parts.length < 2) return { state: "", region: "" };

  // US states → Indy Pass region
  const usRegions: Record<string, string> = {
    // West
    WA: "West", OR: "West", CA: "West", AK: "West", HI: "West", NV: "West",
    // Rockies
    MT: "Rockies", ID: "Rockies", WY: "Rockies", CO: "Rockies", UT: "Rockies",
    NM: "Rockies", AZ: "Rockies", SD: "Rockies", ND: "Rockies",
    // Midwest
    MN: "Midwest", WI: "Midwest", MI: "Midwest", IL: "Midwest", IA: "Midwest",
    MO: "Midwest", IN: "Midwest", OH: "Midwest", NE: "Midwest", KS: "Midwest",
    // East
    ME: "East", NH: "East", VT: "East", MA: "East", CT: "East", RI: "East",
    NY: "East", NJ: "East",
    // Mid-Atlantic
    PA: "Mid-Atlantic", MD: "Mid-Atlantic", DE: "Mid-Atlantic", VA: "Mid-Atlantic",
    WV: "Mid-Atlantic", NC: "Mid-Atlantic", SC: "Mid-Atlantic", GA: "Mid-Atlantic",
    TN: "Mid-Atlantic", KY: "Mid-Atlantic", AL: "Mid-Atlantic",
  };

  // Canadian provinces
  const canadianProvinces = new Set([
    "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
  ]);

  // Try to find a US state or Canadian province code in the parts
  // Check from right to left, skipping country if present
  const country = parts[parts.length - 1];

  // Explicit country suffix
  if (country === "USA" || country === "US") {
    const state = parts.length >= 3 ? parts[parts.length - 2] : parts[0];
    return { state, region: usRegions[state] || "USA" };
  }
  if (country === "Canada" || country === "CA") {
    const province = parts.length >= 3 ? parts[parts.length - 2] : parts[0];
    return { state: province, region: "Canada" };
  }
  if (country === "Japan" || country === "JP") {
    const prefecture = parts.length >= 3 ? parts[parts.length - 2] : "";
    return { state: prefecture, region: "Japan" };
  }
  if (["Chile", "Argentina", "CL", "AR"].includes(country)) {
    const state = parts.length >= 3 ? parts[parts.length - 2] : "";
    return { state, region: "South America" };
  }

  // No country suffix — try to identify by state/province code
  // "City, ST" format: last part is a 2-letter code
  const lastPart = parts[parts.length - 1];
  if (lastPart.length === 2) {
    const code = lastPart.toUpperCase();
    if (usRegions[code]) {
      return { state: code, region: usRegions[code] };
    }
    if (canadianProvinces.has(code)) {
      return { state: code, region: "Canada" };
    }
  }

  // Second-to-last part might be state code when last part is country name
  if (parts.length >= 3) {
    const secondLast = parts[parts.length - 2];
    if (secondLast.length === 2) {
      const code = secondLast.toUpperCase();
      if (usRegions[code]) {
        return { state: code, region: usRegions[code] };
      }
      if (canadianProvinces.has(code)) {
        return { state: code, region: "Canada" };
      }
    }
  }

  // Everything else → Europe (covers France, Austria, Spain, Switzerland, etc.)
  return {
    state: parts.length >= 3 ? parts[parts.length - 2] : country,
    region: "Europe",
  };
}

function buildMountainSeeds(
  cards: ResortCard[],
  details: Map<string, ResortDetail>
): MountainSeed[] {
  return cards
    .map((card) => {
      const detail = details.get(card.id) || {
        websiteUrl: null,
        conditionsUrl: null,
        webcamUrl: null,
      };
      const { state, region } = deriveStateAndRegion(card.location);
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

  const seeds = buildMountainSeeds(cards, details);
  writeFileSync(OUTPUT_PATH, JSON.stringify(seeds, null, 2) + "\n");

  const withWebsite = seeds.filter((s) => s.websiteUrl).length;
  const withConditions = seeds.filter(
    (s) => s.closingDateUrl && s.closingDateUrl !== s.websiteUrl
  ).length;

  console.log(`\nWrote ${seeds.length} resorts to ${OUTPUT_PATH}`);
  console.log(`  ${withWebsite} have a website URL`);
  console.log(`  ${withConditions} have a dedicated conditions URL`);

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
