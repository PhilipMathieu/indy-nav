/**
 * Cross-checks closing-dates.json against OnTheSnow resort data.
 *
 * Usage:
 *   npx tsx scripts/cross-check-closing-dates.ts          # Report conflicts
 *   npx tsx scripts/cross-check-closing-dates.ts --fix     # Apply corrections
 *
 * For each resort that matches an OnTheSnow listing, fetches the openFlag
 * and closingDate from the page's embedded JSON. When our data conflicts
 * with OnTheSnow (e.g., we say "open" but OTS says closed), the script
 * either reports the conflict or fixes it (with --fix).
 *
 * Corrections applied:
 *   - If OTS openFlag=2 (closed) and our closingDate is in the future → mark closed
 *   - If OTS has a different closingDate and ours came from google-search → adopt OTS date
 *   - Confidence is capped at "medium" for google-search sources when OTS disagrees
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { Mountain } from "../src/lib/types";

const DATA_DIR = join(process.cwd(), "data");
const CLOSING_DATES_PATH = join(DATA_DIR, "closing-dates.json");
const OTS_MAP_PATH = join(DATA_DIR, "onthesnow-map.json");
const DELAY_MS = 500;
const CONCURRENCY = 5;
const FIX_MODE = process.argv.includes("--fix");

const OTS_BASE = "https://www.onthesnow.com";

// ── OnTheSnow slug mapping ─────────────────────────────────────────────────

interface OtsMapping {
  id: string;
  otsPath: string;
}

// US state name → slug used by OnTheSnow
const STATE_SLUGS: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california",
  CO: "colorado", CT: "connecticut", DE: "delaware", FL: "florida", GA: "georgia",
  HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa",
  KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland",
  MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi",
  MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada", NH: "new-hampshire",
  NJ: "new-jersey", NM: "new-mexico", NY: "new-york", NC: "north-carolina",
  ND: "north-dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania",
  RI: "rhode-island", SC: "south-carolina", SD: "south-dakota", TN: "tennessee",
  TX: "texas", UT: "utah", VT: "vermont", VA: "virginia", WA: "washington",
  WV: "west-virginia", WI: "wisconsin", WY: "wyoming",
  // Canadian provinces
  AB: "alberta", BC: "british-columbia", MB: "manitoba", NB: "new-brunswick",
  NL: "newfoundland-labrador", NS: "nova-scotia", ON: "ontario", PE: "prince-edward-island",
  QC: "quebec", SK: "saskatchewan",
};

async function buildOtsMapping(mountains: Mountain[]): Promise<OtsMapping[]> {
  // Fetch OTS sitemap to get all resort paths
  console.log("Fetching OnTheSnow sitemap...");
  const res = await fetch(`${OTS_BASE}/sitemap_website.xml`, {
    signal: AbortSignal.timeout(30000),
  });
  const xml = await res.text();

  // Extract resort paths: state/slug pairs
  const otsResorts = new Map<string, string>(); // slug -> state/slug
  const regex = /onthesnow\.com\/([^/]+)\/([^/]+)\/ski-resort/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    otsResorts.set(match[2], `${match[1]}/${match[2]}`);
  }
  console.log(`Found ${otsResorts.size} resorts in OnTheSnow sitemap`);

  const mappings: OtsMapping[] = [];

  for (const m of mountains) {
    const id = m.id.replace(/-\d+$/, ""); // strip Drupal suffix

    // Exact slug match
    if (otsResorts.has(id)) {
      mappings.push({ id: m.id, otsPath: otsResorts.get(id)! });
      continue;
    }

    // Fuzzy: strip common suffixes and compare
    const stripSuffixes = (s: string) =>
      s.replace(/-resort$/, "")
        .replace(/-ski-area$/, "")
        .replace(/-mountain$/, "")
        .replace(/-ski-and-snowboard$/, "");

    const ourBase = stripSuffixes(id);
    let found = false;
    for (const [otsSlug, otsPath] of otsResorts) {
      const otsBase = stripSuffixes(otsSlug);
      if (ourBase === otsBase || id.includes(otsSlug) || otsSlug.includes(id)) {
        mappings.push({ id: m.id, otsPath });
        found = true;
        break;
      }
    }

    if (!found) {
      // Try with state prefix to disambiguate
      const stateSlug = STATE_SLUGS[m.state];
      if (stateSlug) {
        for (const [otsSlug, otsPath] of otsResorts) {
          if (otsPath.startsWith(stateSlug + "/") && stripSuffixes(otsSlug) === ourBase) {
            mappings.push({ id: m.id, otsPath });
            found = true;
            break;
          }
        }
      }
    }
  }

  console.log(`Mapped ${mappings.length}/${mountains.length} resorts to OnTheSnow\n`);
  return mappings;
}

// ── Fetch OTS data ──────────────────────────────────────────────────────────

interface OtsData {
  openFlag: number | null;
  closingDate: string | null;
  openingDate: string | null;
}

async function fetchOtsData(otsPath: string): Promise<OtsData> {
  const url = `${OTS_BASE}/${otsPath}/ski-resort`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; IndyNav/1.0; cross-check)",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    return { openFlag: null, closingDate: null, openingDate: null };
  }

  const html = await res.text();

  // Extract the first occurrence of openFlag with dates
  const dataMatch = html.match(
    /"openFlag":(\d+),"openingDate":"([^"]*)","closingDate":"([^"]*)"/
  );

  if (dataMatch) {
    return {
      openFlag: parseInt(dataMatch[1]),
      closingDate: dataMatch[3] || null,
      openingDate: dataMatch[2] || null,
    };
  }

  // Fallback: just openFlag
  const flagMatch = html.match(/"openFlag":(\d+)/);
  return {
    openFlag: flagMatch ? parseInt(flagMatch[1]) : null,
    closingDate: null,
    openingDate: null,
  };
}

// ── Cross-check logic ───────────────────────────────────────────────────────

interface Conflict {
  mountain: Mountain;
  otsPath: string;
  reason: string;
  otsData: OtsData;
  fix?: Partial<Mountain>;
}

function checkConflicts(
  mountain: Mountain,
  otsData: OtsData,
  otsPath: string,
  today: string
): Conflict | null {
  // OTS says closed but we have a future closing date
  if (
    otsData.openFlag === 2 &&
    mountain.closingDate &&
    mountain.closingDate >= today
  ) {
    // OTS closing date for current season (before today) is the real close date
    // If OTS closingDate is next season (> today), we can't use it as correction
    const otsIsCurrentSeason =
      otsData.closingDate && otsData.closingDate < today;

    return {
      mountain,
      otsPath,
      otsData,
      reason: `OTS says CLOSED (openFlag=2), we say open until ${mountain.closingDate}`,
      fix: otsIsCurrentSeason
        ? {
            closingDate: otsData.closingDate,
            closingDateConfidence: "medium",
            closingDateSource: `cross-checked: ${mountain.closingDateSource}`,
          }
        : {
            closingDateConfidence:
              mountain.closingDateConfidence === "high" ? "medium" : "low",
          },
    };
  }

  // Different closing dates (>1 day apart) when ours came from google-search
  if (
    otsData.openFlag === 1 &&
    otsData.closingDate &&
    mountain.closingDate &&
    mountain.closingDateSource === "google-search" &&
    Math.abs(
      new Date(otsData.closingDate).getTime() -
        new Date(mountain.closingDate).getTime()
    ) >
      86400000 // >1 day difference
  ) {
    return {
      mountain,
      otsPath,
      otsData,
      reason: `Date mismatch (google-search): ours=${mountain.closingDate}, OTS=${otsData.closingDate}`,
      fix: {
        closingDate: otsData.closingDate,
        closingDateConfidence: "medium",
        closingDateSource: `cross-checked: ${mountain.closingDateSource}`,
      },
    };
  }

  return null;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(CLOSING_DATES_PATH)) {
    console.error("No closing-dates.json found. Run the pipeline first.");
    process.exit(1);
  }

  const mountains: Mountain[] = JSON.parse(
    readFileSync(CLOSING_DATES_PATH, "utf-8")
  );

  // Build or load OTS mapping
  let mappings: OtsMapping[];
  if (existsSync(OTS_MAP_PATH)) {
    console.log("Loading cached OnTheSnow mapping...");
    mappings = JSON.parse(readFileSync(OTS_MAP_PATH, "utf-8"));
    console.log(`${mappings.length} cached mappings\n`);
  } else {
    mappings = await buildOtsMapping(mountains);
    writeFileSync(OTS_MAP_PATH, JSON.stringify(mappings, null, 2));
    console.log(`Saved mapping to ${OTS_MAP_PATH}\n`);
  }

  const mountainMap = new Map(mountains.map((m) => [m.id, m]));
  const today = new Date().toISOString().slice(0, 10);
  const conflicts: Conflict[] = [];

  // Fetch OTS data in batches
  for (let i = 0; i < mappings.length; i += CONCURRENCY) {
    const batch = mappings.slice(i, i + CONCURRENCY);
    const batchNum = Math.floor(i / CONCURRENCY) + 1;
    const totalBatches = Math.ceil(mappings.length / CONCURRENCY);
    console.log(`Checking batch ${batchNum}/${totalBatches}...`);

    const results = await Promise.all(
      batch.map(async (mapping) => {
        const otsData = await fetchOtsData(mapping.otsPath);
        const mountain = mountainMap.get(mapping.id);
        if (!mountain) return null;
        return checkConflicts(mountain, otsData, mapping.otsPath, today);
      })
    );

    for (const conflict of results) {
      if (conflict) conflicts.push(conflict);
    }

    if (i + CONCURRENCY < mappings.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  // Report
  console.log(`\n=== Cross-check results ===`);
  console.log(`Checked: ${mappings.length} resorts`);
  console.log(`Conflicts: ${conflicts.length}\n`);

  for (const c of conflicts) {
    console.log(`❌ ${c.mountain.name} (${c.mountain.id})`);
    console.log(`   ${c.reason}`);
    console.log(`   OTS: ${c.otsPath}`);
    if (c.fix) {
      console.log(`   Fix: ${JSON.stringify(c.fix)}`);
    }
    console.log();
  }

  // Apply fixes
  if (FIX_MODE && conflicts.length > 0) {
    console.log("Applying fixes...");
    for (const c of conflicts) {
      if (c.fix) {
        const m = mountainMap.get(c.mountain.id);
        if (m) Object.assign(m, c.fix);
      }
    }

    const updated = Array.from(mountainMap.values());
    // Re-sort: closing date desc, nulls last
    updated.sort((a, b) => {
      if (!a.closingDate && !b.closingDate) return 0;
      if (!a.closingDate) return 1;
      if (!b.closingDate) return -1;
      return b.closingDate.localeCompare(a.closingDate);
    });

    writeFileSync(CLOSING_DATES_PATH, JSON.stringify(updated, null, 2));
    console.log(`\nWrote ${conflicts.length} fixes to ${CLOSING_DATES_PATH}`);
  } else if (conflicts.length > 0 && !FIX_MODE) {
    console.log("Run with --fix to apply corrections.");
  } else {
    console.log("No conflicts found.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
