"use client";

import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";

const REGIONS = [
  "East",
  "Mid-Atlantic",
  "Midwest",
  "Rockies",
  "West",
  "Canada",
  "Japan",
  "Europe",
  "South America",
] as const;

interface RegionFilterProps {
  selected: string[];
  onSelectionChange: (regions: string[]) => void;
}

export function RegionFilter({ selected, onSelectionChange }: RegionFilterProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <span className="text-sm text-muted-foreground sm:leading-7">Region:</span>
      <ToggleGroup
        value={selected}
        onValueChange={onSelectionChange}
        variant="outline"
        size="sm"
        spacing={4}
        aria-label="Filter by region"
        className="w-full flex-wrap gap-2 sm:w-auto sm:flex-1 sm:gap-4"
      >
        {REGIONS.map((region) => (
          <ToggleGroupItem
            key={region}
            value={region}
            className="h-9 px-3 text-xs sm:h-7 sm:px-2 sm:py-1"
          >
            {region}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
