"use client";

import { useState } from "react";
import { ClosingDatesTable } from "@/components/closing-dates-table";
import { ResortMap } from "@/components/resort-map";
import type { Mountain, MountainSeed } from "@/lib/types";
import closingDatesRaw from "../../data/closing-dates.json";
import mountainSeedsRaw from "../../data/mountains.json";

const seedLookup = new Map(
  (mountainSeedsRaw as MountainSeed[]).map((s) => [s.id, s])
);

const mountains: Mountain[] = (closingDatesRaw as Omit<Mountain, "lat" | "lon">[]).map((m) => {
  const seed = seedLookup.get(m.id);
  return { ...m, lat: seed?.lat ?? null, lon: seed?.lon ?? null };
});

export default function Home() {
  const [selectedMountainId, setSelectedMountainId] = useState<string | null>(null);
  const [asOfDate, setAsOfDate] = useState<Date | undefined>(undefined);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Indy Nav
        </h1>
      </div>
      <ResortMap
        mountains={mountains}
        asOfDate={asOfDate}
        selectedRegions={selectedRegions}
        selectedMountainId={selectedMountainId}
        onSelectMountain={setSelectedMountainId}
      />
      <ClosingDatesTable
        mountains={mountains}
        asOfDate={asOfDate}
        onAsOfDateChange={setAsOfDate}
        selectedRegions={selectedRegions}
        onSelectedRegionsChange={setSelectedRegions}
        selectedMountainId={selectedMountainId}
        onSelectMountain={setSelectedMountainId}
      />
      <footer className="mt-12 border-t pt-6 text-xs text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">How it works</p>
        <p>
          Closing dates are gathered automatically each morning by fetching
          mountain websites and using AI (Gemini Flash Lite) to extract season
          end dates. Dates with high confidence come from official announcements;
          medium and low confidence dates are inferred from schedules, snow
          reports, or web searches. High-confidence dates are locked in and not
          re-checked.
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
