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
import type { Mountain } from "@/lib/types";
import { parseISO, isBefore, startOfDay } from "date-fns";

interface ClosingDatesTableProps {
  mountains: Mountain[];
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

  // Open mountains: sorted by closing date ascending (soonest closing first)
  open.sort((a, b) => a.closingDate!.localeCompare(b.closingDate!));
  // Unknown: sorted by name
  unknown.sort((a, b) => a.name.localeCompare(b.name));
  // Closed: sorted by closing date descending (most recently closed first)
  closed.sort((a, b) => b.closingDate!.localeCompare(a.closingDate!));

  return [...open, ...unknown, ...closed];
}

export function ClosingDatesTable({ mountains }: ClosingDatesTableProps) {
  const [asOfDate, setAsOfDate] = React.useState<Date | undefined>(undefined);
  const [sorting, setSorting] = React.useState<SortingState>([]);

  const sortedData = React.useMemo(() => {
    // When user manually sorts via column headers, use TanStack sorting
    if (sorting.length > 0) return mountains;
    // Otherwise use the custom group-and-sort logic
    return groupAndSort(mountains, asOfDate);
  }, [mountains, asOfDate, sorting]);

  const table = useReactTable({
    data: sortedData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
  });

  const referenceDate = asOfDate ?? new Date();

  return (
    <div className="space-y-4">
      <DateFilter date={asOfDate} onDateChange={setAsOfDate} />
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
                return (
                  <TableRow
                    key={row.id}
                    className={
                      status === "closed"
                        ? "opacity-50"
                        : status === "unknown"
                          ? "opacity-75"
                          : ""
                    }
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
        {mountains.length} mountains
        {asOfDate ? ` as of ${referenceDate.toLocaleDateString()}` : ""}
      </p>
    </div>
  );
}
