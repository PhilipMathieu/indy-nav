"use client";

import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import type { TerrainFilter as TerrainFilterValue } from "@/lib/terrain";

const OPTIONS: { value: TerrainFilterValue; label: string; title: string }[] = [
  { value: "all", label: "All", title: "All mountains" },
  { value: "downhill", label: "Downhill", title: "Mountains with lift-served downhill skiing" },
  { value: "xc", label: "XC", title: "Mountains with cross-country (Nordic) trails" },
];

interface TerrainFilterProps {
  value: TerrainFilterValue;
  onValueChange: (value: TerrainFilterValue) => void;
}

export function TerrainFilter({ value, onValueChange }: TerrainFilterProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Type:</span>
      <ToggleGroup
        value={[value]}
        // Single choice: clicking the active option again keeps it selected.
        onValueChange={(next: string[]) => {
          const picked = next[0] as TerrainFilterValue | undefined;
          if (picked) onValueChange(picked);
        }}
        variant="outline"
        size="sm"
        spacing={4}
      >
        {OPTIONS.map((option) => (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            title={option.title}
            className="text-xs px-2 py-1 h-7"
          >
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
