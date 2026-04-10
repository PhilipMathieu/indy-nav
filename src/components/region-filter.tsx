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
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Region:</span>
      <ToggleGroup
        value={selected}
        onValueChange={onSelectionChange}
        variant="outline"
        size="sm"
        spacing={4}
      >
        {REGIONS.map((region) => (
          <ToggleGroupItem
            key={region}
            value={region}
            className="text-xs px-2 py-1 h-7"
          >
            {region}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
