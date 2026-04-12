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
import { columns } from "@/components/columns";
import { DateFilter } from "@/components/date-filter";
import { RegionFilter } from "@/components/region-filter";
import type { Mountain } from "@/lib/types";
import { parseISO, isBefore, startOfDay } from "date-fns";

interface ClosingDatesTableProps {
  mountains: Mountain[];
  asOfDate: Date | undefined;
  onAsOfDateChange: (date: Date | undefined) => void;
  selectedRegions: string[];
  onSelectedRegionsChange: (regions: string[]) => void;
  selectedMountainId: string | null;
  onSelectMountain: (id: string | null) => void;
}

type MountainStatus = "open" | "unknown" | "closed";

function getMountainStatus(
  mountain: Mountain,
  asOfDate: Date
): MountainStatus {
  if (!mountain.closingDate) return "unknown";
  const closing = parseISO(mountain.closingDate);
  if (isBefore(closing, startOfDay(asOfDate))) return "closed";
  return "open";
}

function groupAndSort(
  mountains: Mountain[],
  asOfDate: Date | undefined
): Mountain[] {
  const referenceDate = asOfDate ?? new Date();

  const open: Mountain[] = [];
  const unknown: Mountain[] = [];
  const closed: Mountain[] = [];

  for (const m of mountains) {
    const status = getMountainStatus(m, referenceDate);
    if (status === "open") open.push(m);
    else if (status === "unknown") unknown.push(m);
    else closed.push(m);
  }

  open.sort((a, b) => a.closingDate!.localeCompare(b.closingDate!));
  unknown.sort((a, b) => a.name.localeCompare(b.name));
  closed.sort((a, b) => b.closingDate!.localeCompare(a.closingDate!));

  return [...open, ...unknown, ...closed];
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

  const filteredData = React.useMemo(() => {
    if (selectedRegions.length === 0) return mountains;
    return mountains.filter((m) => selectedRegions.includes(m.region));
  }, [mountains, selectedRegions]);

  const sortedData = React.useMemo(() => {
    if (sorting.length > 0) return filteredData;
    return groupAndSort(filteredData, asOfDate);
  }, [filteredData, asOfDate, sorting]);

  const table = useReactTable({
    data: sortedData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
  });

  const referenceDate = asOfDate ?? new Date();

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
                const status = getMountainStatus(
                  row.original,
                  referenceDate
                );
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
