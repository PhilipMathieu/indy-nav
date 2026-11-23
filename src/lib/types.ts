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
}

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
}
