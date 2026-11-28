"use client";

import { useState } from "react";
import { ClosingDatesTable } from "@/components/closing-dates-table";
import { ResortMap } from "@/components/resort-map";
import type { Mountain, MountainSeed } from "@/lib/types";
import type { LatLon } from "@/lib/geo";
import { getSeason, LEGACY_SEASON_LABEL } from "@/lib/season";
import { getTerrain, type TerrainFilter } from "@/lib/terrain";
import closingDatesRaw from "../../data/closing-dates.json";
import mountainSeedsRaw from "../../data/mountains.json";

const seedLookup = new Map(
  (mountainSeedsRaw as MountainSeed[]).map((s) => [s.id, s])
);

const season = getSeason();

// Rows from an earlier season (before the pipeline has caught up after the
// August rollover) keep the resort on the map but show its dates as unknown.
const mountains: Mountain[] = (closingDatesRaw as Omit<Mountain, "lat" | "lon">[]).map((m) => {
  const seed = seedLookup.get(m.id);
  const located = {
    ...m,
    // mountains.json is re-scraped weekly; closing-dates.json rows keep the
    // region/state from when the pipeline last checked them.
    region: seed?.region || m.region,
    state: seed?.state || m.state,
    lat: seed?.lat ?? null,
    lon: seed?.lon ?? null,
    terrain: getTerrain(seed),
    stats: seed?.stats,
  };
  if ((m.season ?? LEGACY_SEASON_LABEL) === season.label) return located;
  return { ...located, openingDate: null, closingDate: null, closingDateConfidence: "low" };
});

export default function Home() {
  const [selectedMountainId, setSelectedMountainId] = useState<string | null>(null);
  const [asOfDate, setAsOfDate] = useState<Date | undefined>(undefined);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [userLocation, setUserLocation] = useState<LatLon | null>(null);
  const [terrainFilter, setTerrainFilter] = useState<TerrainFilter>("all");

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:py-8 lg:max-w-5xl">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Indy Nav
        </h1>
        <p className="text-sm text-muted-foreground">
          Opening and closing dates for Indy Pass mountains, {season.label} season
        </p>
      </div>
      <ResortMap
        mountains={mountains}
        asOfDate={asOfDate}
        selectedRegions={selectedRegions}
        terrainFilter={terrainFilter}
        selectedMountainId={selectedMountainId}
        onSelectMountain={setSelectedMountainId}
        userLocation={userLocation}
      />
      <ClosingDatesTable
        mountains={mountains}
        asOfDate={asOfDate}
        onAsOfDateChange={setAsOfDate}
        selectedRegions={selectedRegions}
        onSelectedRegionsChange={setSelectedRegions}
        terrainFilter={terrainFilter}
        onTerrainFilterChange={setTerrainFilter}
        selectedMountainId={selectedMountainId}
        onSelectMountain={setSelectedMountainId}
        userLocation={userLocation}
        onUserLocationChange={setUserLocation}
      />
      <footer className="mt-12 border-t pt-6 text-xs text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">How it works</p>
        <p>
          Opening and closing dates are gathered automatically each morning by
          fetching mountain websites and using AI (Gemini Flash Lite) to extract
          season dates, then cross-checked against OnTheSnow. Dates with high
          confidence come from official announcements; medium and low confidence
          dates (shown in gray italics) are inferred from schedules, snow
          reports, or web searches. High-confidence dates are locked in for the
          season and not re-checked.
        </p>
        <p>
          This is an unofficial community tool and is not affiliated with Indy
          Pass. Always confirm with the mountain before making travel plans.
          {" "}
          <a
            href="https://github.com/PhilipMathieu/indy-nav"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Source on GitHub
          </a>
        </p>
        <a
          href="https://buymeacoffee.com/philipmathieu"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            src="https://img.shields.io/badge/%F0%9F%8D%BB_BUY_ME_A_BREWSKI-E4312B?style=flat-square"
            alt="Buy Me a Brewski"
            className="mt-2"
          />
        </a>
      </footer>
    </main>
  );
}
