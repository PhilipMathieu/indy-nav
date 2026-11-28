"use client";

import { ColumnDef, type Row, type RowData } from "@tanstack/react-table";
import { ArrowUpDown, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDistanceToNow, format, parseISO } from "date-fns";
import type { Confidence, Mountain } from "@/lib/types";
import { STATUS_LABEL, type MountainStatus } from "@/lib/status";

/** A table row: a mountain plus its status on the "as of" date. */
export type MountainRow = Mountain & { status: MountainStatus };

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /**
     * Numeric columns set this to sort inside the status groups (open
     * first) instead of across the whole table. See `sortWithinStatus`.
     */
    statusSortValue?: (row: TData) => number | null | undefined;
  }
}

const confidenceVariant: Record<Confidence, "default" | "secondary" | "destructive"> = {
  high: "default",
  medium: "secondary",
  low: "destructive",
};

const statusClass: Record<MountainStatus, string> = {
  open: "bg-[#da1e28] text-white",
  "opening-soon": "bg-[#0f62fe] text-white",
  unknown: "bg-secondary text-secondary-foreground",
  closed: "bg-muted text-muted-foreground",
};

function SortHeader({
  label,
  column,
  descFirst = false,
}: {
  label: string;
  column: { toggleSorting: (desc?: boolean) => void; getIsSorted: () => false | "asc" | "desc" };
  /** Sort descending on the first click (e.g. biggest first). */
  descFirst?: boolean;
}) {
  const sorted = column.getIsSorted();
  return (
    <Button
      variant="ghost"
      onClick={() => column.toggleSorting(sorted ? sorted === "asc" : descFirst)}
    >
      {label}
      <ArrowUpDown className="ml-2 h-4 w-4" />
    </Button>
  );
}

/** Sort by a nullable YYYY-MM-DD field, unknown dates last either way. */
function dateSort(key: "openingDate" | "closingDate") {
  return (a: Row<MountainRow>, b: Row<MountainRow>) => {
    const x = a.original[key];
    const y = b.original[key];
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return x.localeCompare(y);
  };
}

/** A date with a popover showing how sure we are and where it came from. */
function DateCell({
  date,
  confidence,
  reasoning,
  source,
}: {
  date: string | null | undefined;
  confidence: Confidence | undefined;
  reasoning: string | undefined;
  source: string | undefined;
}) {
  if (!date) return <span className="text-muted-foreground">Unknown</span>;

  const sourceIsUrl = !!source && source.startsWith("http");
  const tentative = confidence !== "high";

  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span
        className={tentative ? "text-muted-foreground italic" : undefined}
        title={tentative ? `${confidence ?? "low"} confidence` : undefined}
      >
        {format(parseISO(date), "MMM d, yyyy")}
      </span>
      <Popover>
        <PopoverTrigger
          onClick={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="View source info"
        >
          <Info className="h-3.5 w-3.5" />
        </PopoverTrigger>
        <PopoverContent side="left" className="w-80 space-y-1.5">
          {confidence && (
            <Badge variant={confidenceVariant[confidence]}>{confidence} confidence</Badge>
          )}
          {reasoning && <p className="text-sm text-popover-foreground">{reasoning}</p>}
          {sourceIsUrl && (
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-primary underline underline-offset-2 hover:text-primary/80 block truncate"
            >
              {source}
            </a>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

export const columns: ColumnDef<MountainRow>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <SortHeader label="Mountain" column={column} />,
    cell: ({ row }) => (
      <a
        href={row.original.websiteUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-4 hover:text-primary/80 block max-w-[200px] truncate"
        title={row.getValue("name") as string}
      >
        {row.getValue("name")}
      </a>
    ),
  },
  {
    accessorKey: "state",
    header: ({ column }) => <SortHeader label="State" column={column} />,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.original.status;
      return <Badge className={statusClass[status]}>{STATUS_LABEL[status]}</Badge>;
    },
    enableSorting: false,
  },
  {
    accessorKey: "openingDate",
    header: ({ column }) => <SortHeader label="Opens" column={column} />,
    cell: ({ row }) => (
      <DateCell
        date={row.original.openingDate}
        confidence={row.original.openingDateConfidence}
        reasoning={row.original.openingDateReasoning}
        source={row.original.openingDateSource}
      />
    ),
    sortingFn: dateSort("openingDate"),
  },
  {
    accessorKey: "closingDate",
    header: ({ column }) => <SortHeader label="Closes" column={column} />,
    cell: ({ row }) => (
      <DateCell
        date={row.original.closingDate}
        confidence={row.original.closingDateConfidence}
        reasoning={row.original.closingDateReasoning}
        source={row.original.closingDateSource}
      />
    ),
    sortingFn: dateSort("closingDate"),
  },
  {
    accessorKey: "lastUpdated",
    header: "Last Updated",
    cell: ({ row }) => {
      const date = row.getValue("lastUpdated") as string;
      if (!date) return "—";
      return formatDistanceToNow(parseISO(date), { addSuffix: true });
    },
  },
];
