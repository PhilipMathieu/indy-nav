import type { MountainSeed } from "./types";

/**
 * What kind of skiing a mountain offers:
 * - alpine: lift-served downhill only
 * - xc: cross-country (Nordic) trails only
 * - both: downhill plus cross-country trails
 */
export type Terrain = "alpine" | "xc" | "both";

/** Filter choice shared by the map and table. */
export type TerrainFilter = "all" | "downhill" | "xc";

export const TERRAIN_LABEL: Record<Terrain, string> = {
  alpine: "Downhill",
  xc: "Cross-country",
  both: "Downhill + XC",
};

/**
 * Indy Pass tags every resort card with `data-isnordic` (has cross-country
 * trails) and `data-isalpinexc` (has both downhill and cross-country). Their
 * own `data-isxconly` flag misses a few Nordic centers (e.g. Great Glen
 * Trails), so cross-country-only is read as "Nordic but not alpine + XC",
 * which matches the site's Alpine / Cross Country category filter exactly.
 */
export function getTerrain(seed: Pick<MountainSeed, "isNordic" | "isAlpineXc"> | undefined): Terrain {
  if (!seed?.isNordic) return "alpine";
  return seed.isAlpineXc ? "both" : "xc";
}

/** Downhill includes mountains with both; so does cross-country. */
export function matchesTerrain(terrain: Terrain | undefined, filter: TerrainFilter): boolean {
  const t = terrain ?? "alpine";
  if (filter === "all") return true;
  if (filter === "downhill") return t !== "xc";
  return t !== "alpine";
}
