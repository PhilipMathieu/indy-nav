/**
 * Cross-checks closing-dates.json against OnTheSnow resort data.
 *
 * Usage:
 *   npx tsx scripts/cross-check-closing-dates.ts          # Report conflicts
 *   npx tsx scripts/cross-check-closing-dates.ts --fix     # Apply corrections
 *
 * For each resort that matches an OnTheSnow listing, fetches the openFlag,
 * openingDate and closingDate from the page's embedded JSON. When our data
 * conflicts with OnTheSnow (e.g., we say "open" but OTS says closed), the
 * script either reports the conflict or fixes it (with --fix).
 *
 * Only OTS dates inside the current season count, since OTS keeps showing
 * last season's dates until a resort publishes new ones.
 *
 * Corrections applied:
 *   - OTS says closed for the season (closing date this season, already past)
 *     and our closingDate is still ahead → adopt the OTS date
 *   - OTS says closed with no usable date, after March 1, once our opening
 *     date has passed → lower our closing confidence
 *   - OTS has a different closingDate and ours came from google-search → adopt OTS date
 *   - We have no opening date, or a low-confidence one that differs → adopt
 *     the OTS openingDate
 *   - OTS says open now but our opening date is missing or still ahead (and
 *     not high confidence) → set it to the OTS opening date, or to today as a
 *     low-confidence upper bound
 *
 * The OnTheSnow mapping in data/onthesnow-map.json is extended for resorts
 * that don't have one yet and pruned of resorts no longer on the list.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { Mountain } from "../src/lib/types";
import { getSeason, isInSeason, LEGACY_SEASON_LABEL } from "../src/lib/season";

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
      // Substring matches only for slugs long enough not to match by accident
      const contains =
        (otsSlug.length >= 6 && id.includes(otsSlug)) ||
        (id.length >= 6 && otsSlug.includes(id));
      if (ourBase === otsBase || contains) {
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

  console.log(`Mapped ${mappings.length}/${mountains.length} new resorts to OnTheSnow\n`);
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

const season = getSeason();
const DAY_MS = 86400000;

const daysApart = (a: string, b: string) =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) / DAY_MS;

/** Normalize an OTS date to YYYY-MM-DD, or null if it isn't one. */
function otsDate(raw: string | null): string | null {
  const d = raw?.slice(0, 10) ?? null;
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function checkConflicts(
  mountain: Mountain,
  otsData: OtsData,
  otsPath: string,
  today: string
): Conflict[] {
  const conflicts: Conflict[] = [];
  const add = (reason: string, fix?: Partial<Mountain>) =>
    conflicts.push({ mountain, otsPath, otsData, reason, fix });

  // Rows still from an earlier season are the pipeline's job, not ours
  if ((mountain.season ?? LEGACY_SEASON_LABEL) !== season.label) return conflicts;

  const otsUrl = `${OTS_BASE}/${otsPath}/ski-resort`;
  const otsClosing = otsDate(otsData.closingDate);
  const otsOpening = otsDate(otsData.openingDate);
  const closingThisSeason = otsClosing && isInSeason(otsClosing, season) ? otsClosing : null;
  const openingThisSeason = otsOpening && isInSeason(otsOpening, season) ? otsOpening : null;

  // ── Closing date ──

  // OTS says closed but we have a future closing date
  if (otsData.openFlag === 2 && mountain.closingDate && mountain.closingDate >= today) {
    if (closingThisSeason && closingThisSeason < today) {
      // Closed for the season, and OTS has this season's closing date
      add(`OTS says CLOSED on ${closingThisSeason}, we say open until ${mountain.closingDate}`, {
        closingDate: closingThisSeason,
        closingDateConfidence: "medium",
        closingDateSource: otsUrl,
      });
    } else {
      // "Closed" before opening day, or a midwinter midweek/weather closure,
      // says nothing about the season ending. Only trust it late in the
      // season once the mountain has actually opened.
      const lateSeason = today >= `${season.endYear}-03-01`;
      const hasOpened = !!mountain.openingDate && mountain.openingDate <= today;
      if (lateSeason && hasOpened) {
        add(`OTS says CLOSED (openFlag=2), we say open until ${mountain.closingDate}`, {
          closingDateConfidence: mountain.closingDateConfidence === "high" ? "medium" : "low",
        });
      }
    }
  } else if (
    // Different closing dates (>1 day apart) when ours came from google-search
    otsData.openFlag === 1 &&
    closingThisSeason &&
    mountain.closingDate &&
    mountain.closingDateSource === "google-search" &&
    daysApart(closingThisSeason, mountain.closingDate) > 1
  ) {
    add(`Closing date mismatch (google-search): ours=${mountain.closingDate}, OTS=${closingThisSeason}`, {
      closingDate: closingThisSeason,
      closingDateConfidence: "medium",
      closingDateSource: otsUrl,
    });
  }

  // ── Opening date ──

  const ours = mountain.openingDate ?? null;
  const oursConfidence = mountain.openingDateConfidence ?? "low";

  if (otsData.openFlag === 1 && (!ours || ours > today)) {
    // OTS says open now, but we think it hasn't opened yet
    if (oursConfidence === "high" && ours) {
      add(`OTS says OPEN, we say opening ${ours} (high confidence, not changed)`);
    } else if (openingThisSeason && openingThisSeason <= today) {
      add(`OTS says OPEN since ${openingThisSeason}, we say ${ours ?? "unknown"}`, {
        openingDate: openingThisSeason,
        openingDateConfidence: "medium",
        openingDateSource: otsUrl,
        openingDateReasoning: `OnTheSnow lists ${openingThisSeason} as opening day and shows the mountain open.`,
      });
    } else {
      add(`OTS says OPEN, we say ${ours ?? "unknown"}; using today as opening upper bound`, {
        openingDate: today,
        openingDateConfidence: "low",
        openingDateSource: otsUrl,
        openingDateReasoning: `OnTheSnow showed the mountain open on ${today}; it may have opened earlier.`,
      });
    }
  } else if (
    openingThisSeason &&
    (!ours || (oursConfidence === "low" && daysApart(openingThisSeason, ours) > 1))
  ) {
    add(`Opening date from OTS: ours=${ours ?? "unknown"}, OTS=${openingThisSeason}`, {
      openingDate: openingThisSeason,
      openingDateConfidence: "medium",
      openingDateSource: otsUrl,
      openingDateReasoning: `OnTheSnow lists ${openingThisSeason} as opening day.`,
    });
  }

  return conflicts;
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

  // Load the cached OTS mapping, map any resorts that aren't in it yet, and
  // drop resorts that are no longer on the list.
  const cached: OtsMapping[] = existsSync(OTS_MAP_PATH)
    ? JSON.parse(readFileSync(OTS_MAP_PATH, "utf-8"))
    : [];
  console.log(`${cached.length} cached OnTheSnow mappings`);
  const ids = new Set(mountains.map((m) => m.id));
  let mappings = cached.filter((m) => ids.has(m.id));
  const mappedIds = new Set(mappings.map((m) => m.id));
  const unmapped = mountains.filter((m) => !mappedIds.has(m.id));
  if (unmapped.length > 0) {
    try {
      console.log(`Looking up ${unmapped.length} unmapped resorts...`);
      mappings = [...mappings, ...(await buildOtsMapping(unmapped))];
    } catch (err) {
      // The sitemap is a nice-to-have; keep checking the resorts we can
      console.warn(`⚠ Could not extend OnTheSnow mapping: ${err instanceof Error ? err.message : err}\n`);
    }
  }
  if (JSON.stringify(mappings) !== JSON.stringify(cached)) {
    writeFileSync(OTS_MAP_PATH, JSON.stringify(mappings, null, 2));
    console.log(`Saved ${mappings.length} mappings to ${OTS_MAP_PATH}\n`);
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

    for (const found of results) {
      if (found) conflicts.push(...found);
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
  const fixes = conflicts.filter((c) => c.fix);
  if (FIX_MODE && fixes.length > 0) {
    console.log("Applying fixes...");
    for (const c of fixes) {
      const m = mountainMap.get(c.mountain.id);
      if (m) Object.assign(m, c.fix);
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
    console.log(`\nWrote ${fixes.length} fixes to ${CLOSING_DATES_PATH}`);
  } else if (fixes.length > 0 && !FIX_MODE) {
    console.log("Run with --fix to apply corrections.");
  } else {
    console.log("No fixes to apply.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
