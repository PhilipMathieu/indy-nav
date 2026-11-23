/**
 * Ski season helpers.
 *
 * A season is named by the two years it spans, e.g. "2026-27". The season
 * rolls over on August 1: anything from August 1, 2026 through July 31, 2027
 * belongs to the 2026-27 season. August is the quietest month for Northern
 * Hemisphere areas (last spring closers are done by mid-July), so it is a safe
 * point to start looking for the next season's dates.
 *
 * Southern Hemisphere areas (one South American resort today) ski June to
 * October and are not modelled separately.
 */

/** Month (0-indexed) on whose first day a new season starts. 7 = August. */
export const SEASON_ROLLOVER_MONTH = 7;

export interface Season {
  /** Short label used in data and UI, e.g. "2026-27". */
  label: string;
  /** Calendar year the season starts in, e.g. 2026. */
  startYear: number;
  /** Calendar year the season ends in, e.g. 2027. */
  endYear: number;
}

/** Label given to rows written before seasons were tracked. */
export const LEGACY_SEASON_LABEL = "2025-26";

/**
 * Return the season that contains `date`.
 *
 * Uses UTC date parts so the pipeline (UTC on CI) and the build agree.
 */
export function getSeason(date: Date = new Date()): Season {
  const year = date.getUTCFullYear();
  const startYear = date.getUTCMonth() >= SEASON_ROLLOVER_MONTH ? year : year - 1;
  return seasonFromStartYear(startYear);
}

/** Build a season from the year it starts in. */
export function seasonFromStartYear(startYear: number): Season {
  const endYear = startYear + 1;
  return {
    label: `${startYear}-${String(endYear % 100).padStart(2, "0")}`,
    startYear,
    endYear,
  };
}

/** Return the season a `YYYY-MM-DD` date falls in, or null if malformed. */
export function seasonOfIsoDate(isoDate: string): Season | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return getSeason(d);
}

/** True when a `YYYY-MM-DD` date falls inside `season`. */
export function isInSeason(isoDate: string | null | undefined, season: Season): boolean {
  if (!isoDate) return false;
  return seasonOfIsoDate(isoDate)?.label === season.label;
}
