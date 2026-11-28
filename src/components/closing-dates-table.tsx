"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { columns, DateCell, statusClass, type MountainRow } from "@/components/columns";
import { DateFilter } from "@/components/date-filter";
import { RegionFilter } from "@/components/region-filter";
import { TerrainFilter } from "@/components/terrain-filter";
import { NearMe } from "@/components/near-me";
import { distanceMiles, type LatLon } from "@/lib/geo";
import type { Mountain } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getMountainStatus, groupAndSort, sortWithinStatus, STATUS_LABEL } from "@/lib/status";
import { matchesTerrain, TERRAIN_LABEL, type TerrainFilter as TerrainFilterValue } from "@/lib/terrain";

/** Sort options for the small-screen list, which has no column headers. */
const MOBILE_SORTS: { value: string; label: string; sorting: SortingState }[] = [
  { value: "status", label: "Status", sorting: [] },
  { value: "name", label: "Mountain (A–Z)", sorting: [{ id: "name", desc: false }] },
  { value: "openingDate", label: "Opens (earliest)", sorting: [{ id: "openingDate", desc: false }] },
  { value: "closingDate-asc", label: "Closes (earliest)", sorting: [{ id: "closingDate", desc: false }] },
  { value: "closingDate", label: "Closes (latest)", sorting: [{ id: "closingDate", desc: true }] },
  { value: "vertical", label: "Biggest (vertical)", sorting: [{ id: "vertical", desc: true }] },
  { value: "distance", label: "Nearest", sorting: [{ id: "distance", desc: false }] },
];

/** Per-column responsive classes, set via `meta.className` in columns.tsx. */
function columnClass(def: { meta?: unknown }) {
  return (def.meta as { className?: string } | undefined)?.className;
}

function rowOpacity(status: MountainRow["status"]) {
  return status === "closed" ? "opacity-50" : status === "unknown" ? "opacity-75" : "";
}

interface ClosingDatesTableProps {
  mountains: Mountain[];
  asOfDate: Date | undefined;
  onAsOfDateChange: (date: Date | undefined) => void;
  selectedRegions: string[];
  onSelectedRegionsChange: (regions: string[]) => void;
  terrainFilter: TerrainFilterValue;
  onTerrainFilterChange: (value: TerrainFilterValue) => void;
  selectedMountainId: string | null;
  onSelectMountain: (id: string | null) => void;
  userLocation: LatLon | null;
  onUserLocationChange: (location: LatLon | null) => void;
}

export function ClosingDatesTable({
  mountains,
  asOfDate,
  onAsOfDateChange,
  selectedRegions,
  onSelectedRegionsChange,
  terrainFilter,
  onTerrainFilterChange,
  selectedMountainId,
  onSelectMountain,
  userLocation,
  onUserLocationChange,
}: ClosingDatesTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  // The table (sm and up) and the card list (below sm) are both rendered and
  // one is hidden with CSS, so each keeps its own refs for scrolling.
  const rowRefs = React.useRef<Map<string, HTMLTableRowElement>>(new Map());
  const cardRefs = React.useRef<Map<string, HTMLLIElement>>(new Map());

  const referenceDate = React.useMemo(() => asOfDate ?? new Date(), [asOfDate]);

  const filteredData = React.useMemo<MountainRow[]>(() => {
    const inRegion = mountains.filter(
      (m) =>
        (selectedRegions.length === 0 || selectedRegions.includes(m.region)) &&
        matchesTerrain(m.terrain, terrainFilter)
    );
    return inRegion.map((m) => ({
      ...m,
      status: getMountainStatus(m, referenceDate),
      distanceMi:
        userLocation && m.lat != null && m.lon != null
          ? distanceMiles(userLocation, { lat: m.lat, lon: m.lon })
          : null,
    }));
  }, [mountains, selectedRegions, terrainFilter, referenceDate, userLocation]);

  // Sharing a location sorts nearest first; clearing it drops that sort.
  const handleUserLocationChange = (location: LatLon | null) => {
    onUserLocationChange(location);
    setSorting(location ? [{ id: "distance", desc: false }] : []);
  };

  // Numeric columns that declare `meta.statusSortValue` are sorted here,
  // inside the status groups, rather than by TanStack across the table.
  const statusSort = React.useMemo(() => {
    const active = sorting[0];
    if (!active) return null;
    const column = columns.find((c) => c.id === active.id);
    const value = column?.meta?.statusSortValue;
    return value ? { value, desc: active.desc } : null;
  }, [sorting]);

  const sortedData = React.useMemo(() => {
    if (statusSort) return sortWithinStatus(filteredData, statusSort.value, statusSort.desc);
    if (sorting.length > 0) return filteredData;
    return groupAndSort(filteredData, referenceDate);
  }, [filteredData, referenceDate, sorting, statusSort]);

  const table = useReactTable({
    data: sortedData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    manualSorting: statusSort !== null,
    // "distance" is sort-only. Last Updated makes way for the miles shown
    // beside the state so the table keeps its width.
    state: {
      sorting,
      columnVisibility: { distance: false, lastUpdated: userLocation === null },
    },
  });

  // Sorting set from a desktop column header may have no matching option.
  const mobileSort =
    MOBILE_SORTS.find(
      (o) =>
        o.sorting.length === sorting.length &&
        o.sorting.every((x, i) => x.id === sorting[i].id && x.desc === sorting[i].desc)
    )?.value ?? "";

  // Scroll to selected mountain when it changes
  React.useEffect(() => {
    if (!selectedMountainId) return;
    const el = [
      rowRefs.current.get(selectedMountainId),
      cardRefs.current.get(selectedMountainId),
    ].find((e) => e && e.offsetParent !== null);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [selectedMountainId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:gap-4">
        <DateFilter date={asOfDate} onDateChange={onAsOfDateChange} />
        <TerrainFilter value={terrainFilter} onValueChange={onTerrainFilterChange} />
        <RegionFilter selected={selectedRegions} onSelectionChange={onSelectedRegionsChange} />
        <NearMe location={userLocation} onLocationChange={handleUserLocationChange} />
      </div>
      <div className="flex items-center gap-2 sm:hidden">
        <label htmlFor="mobile-sort" className="shrink-0 text-sm text-muted-foreground">
          Sort by:
        </label>
        <select
          id="mobile-sort"
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
          value={mobileSort}
          onChange={(e) =>
            setSorting(MOBILE_SORTS.find((o) => o.value === e.target.value)?.sorting ?? [])
          }
        >
          {mobileSort === "" && <option value="">Custom</option>}
          {MOBILE_SORTS.filter((o) => o.value !== "distance" || userLocation).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <ul className="divide-y rounded-md border sm:hidden" data-testid="mountain-list">
        {table.getRowModel().rows.length ? (
          table.getRowModel().rows.map((row) => {
            const m = row.original;
            const isSelected = m.id === selectedMountainId;
            return (
              <li
                key={row.id}
                ref={(el) => {
                  if (el) cardRefs.current.set(m.id, el);
                  else cardRefs.current.delete(m.id);
                }}
                className={cn(
                  "cursor-pointer space-y-2 px-3 py-3 transition-colors",
                  isSelected && "bg-accent",
                  rowOpacity(m.status)
                )}
                onClick={() => onSelectMountain(isSelected ? null : m.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <a
                      href={m.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="block font-medium underline underline-offset-4 hover:text-primary/80 break-words"
                    >
                      {m.name}
                    </a>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {m.state}
                      {m.distanceMi != null && (
                        <span className="tabular-nums">· {Math.round(m.distanceMi).toLocaleString("en-US")} mi</span>
                      )}
                      {m.stats?.verticalFt != null && (
                        <span className="tabular-nums">
                          · {m.stats.verticalFt.toLocaleString("en-US")} ft vert
                        </span>
                      )}
                      {m.terrain && m.terrain !== "alpine" && (
                        <Badge
                          variant="outline"
                          className="h-4 rounded-sm px-1 text-[10px] font-semibold tracking-wide text-muted-foreground"
                          title={TERRAIN_LABEL[m.terrain]}
                        >
                          {m.terrain === "xc" ? "XC" : "+XC"}
                        </Badge>
                      )}
                    </p>
                  </div>
                  <Badge className={cn("shrink-0", statusClass[m.status])}>
                    {STATUS_LABEL[m.status]}
                  </Badge>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 text-sm">
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Opens</dt>
                    <dd>
                      <DateCell
                        date={m.openingDate}
                        confidence={m.openingDateConfidence}
                        reasoning={m.openingDateReasoning}
                        source={m.openingDateSource}
                      />
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Closes</dt>
                    <dd>
                      <DateCell
                        date={m.closingDate}
                        confidence={m.closingDateConfidence}
                        reasoning={m.closingDateReasoning}
                        source={m.closingDateSource}
                      />
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })
        ) : (
          <li className="px-3 py-8 text-center text-sm">
            No mountains found. Run the data pipeline first.
          </li>
        )}
      </ul>
      <div className="hidden rounded-md border sm:block" data-testid="mountain-table">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className={columnClass(header.column.columnDef)}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => {
                const status = row.original.status;
                const isSelected = row.original.id === selectedMountainId;
                return (
                  <TableRow
                    key={row.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(row.original.id, el);
                      else rowRefs.current.delete(row.original.id);
                    }}
                    className={cn(isSelected && "bg-accent", rowOpacity(status))}
                    onClick={() => onSelectMountain(isSelected ? null : row.original.id)}
                    style={{ cursor: "pointer" }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className={columnClass(cell.column.columnDef)}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No mountains found. Run the data pipeline first.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        {filteredData.length}{filteredData.length !== mountains.length ? ` of ${mountains.length}` : ""} mountains
        {asOfDate ? ` as of ${referenceDate.toLocaleDateString()}` : ""}
      </p>
    </div>
  );
}
