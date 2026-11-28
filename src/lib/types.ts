export interface MountainSeed {
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
  /** Page the pipeline reads for season dates (conditions, hours or homepage). */
  closingDateUrl: string;
  /** Size and terrain figures from the resort's indyskipass.com page. */
  stats?: ResortStats;
}

/**
 * Figures listed on a resort's indyskipass.com page. Each is null when the
 * page leaves it out (XC-only areas have no alpine figures, for example).
 */
export interface ResortStats {
  verticalFt: number | null;
  summitFt: number | null;
  baseFt: number | null;
  acres: number | null;
  trails: number | null;
  lifts: number | null;
  /** Average annual snowfall, inches. */
  snowfallIn: number | null;
  terrainPark: boolean | null;
  nightSkiing: boolean | null;
  xcTrails: number | null;
  xcKm: number | null;
}

import type { Terrain } from "./terrain";

export type Confidence = "high" | "medium" | "low";

export interface Mountain {
  id: string;
  name: string;
  region: string;
  state: string;
  /**
   * Season these dates belong to, e.g. "2026-27". Rows written before
   * seasons were tracked have no value and count as 2025-26.
   */
  season?: string;
  /** First day of the season, `YYYY-MM-DD`, or null if unknown. */
  openingDate?: string | null;
  openingDateSource?: string;
  openingDateConfidence?: Confidence;
  openingDateReasoning?: string;
  closingDate: string | null;
  closingDateSource: string;
  closingDateConfidence: Confidence;
  closingDateReasoning?: string;
  lastUpdated: string;
  websiteUrl: string;
  lat: number | null;
  lon: number | null;
  /** Merged in from `mountains.json` by the page, like lat/lon. */
  stats?: ResortStats;
  /** Downhill, cross-country or both; merged from mountains.json. */
  terrain?: Terrain;
}
