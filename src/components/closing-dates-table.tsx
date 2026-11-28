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
import { columns, type MountainRow } from "@/components/columns";
import { DateFilter } from "@/components/date-filter";
import { RegionFilter } from "@/components/region-filter";
import type { Mountain } from "@/lib/types";
import { getMountainStatus, groupAndSort, sortWithinStatus } from "@/lib/status";

interface ClosingDatesTableProps {
  mountains: Mountain[];
  asOfDate: Date | undefined;
  onAsOfDateChange: (date: Date | undefined) => void;
  selectedRegions: string[];
  onSelectedRegionsChange: (regions: string[]) => void;
  selectedMountainId: string | null;
  onSelectMountain: (id: string | null) => void;
}

export function ClosingDatesTable({
  mountains,
  asOfDate,
  onAsOfDateChange,
  selectedRegions,
  onSelectedRegionsChange,
  selectedMountainId,
  onSelectMountain,
}: ClosingDatesTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const rowRefs = React.useRef<Map<string, HTMLTableRowElement>>(new Map());

  const referenceDate = React.useMemo(() => asOfDate ?? new Date(), [asOfDate]);

  const filteredData = React.useMemo<MountainRow[]>(() => {
    const inRegion =
      selectedRegions.length === 0
        ? mountains
        : mountains.filter((m) => selectedRegions.includes(m.region));
    return inRegion.map((m) => ({ ...m, status: getMountainStatus(m, referenceDate) }));
  }, [mountains, selectedRegions, referenceDate]);

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
    state: { sorting },
  });

  // Scroll to selected mountain when it changes
  React.useEffect(() => {
    if (!selectedMountainId) return;
    const el = rowRefs.current.get(selectedMountainId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [selectedMountainId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <DateFilter date={asOfDate} onDateChange={onAsOfDateChange} />
        <RegionFilter selected={selectedRegions} onSelectionChange={onSelectedRegionsChange} />
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
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
                    className={
                      (isSelected
                        ? "bg-accent "
                        : "") +
                      (status === "closed"
                        ? "opacity-50"
                        : status === "unknown"
                          ? "opacity-75"
                          : "")
                    }
                    onClick={() => onSelectMountain(isSelected ? null : row.original.id)}
                    style={{ cursor: "pointer" }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
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
