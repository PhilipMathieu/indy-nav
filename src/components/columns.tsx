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
import type { Confidence, Mountain, ResortStats } from "@/lib/types";
import { STATUS_LABEL, type MountainStatus } from "@/lib/status";

/**
 * A table row: a mountain plus its status on the "as of" date and, once the
 * viewer has shared a location, its straight-line distance in miles.
 */
export type MountainRow = Mountain & { status: MountainStatus; distanceMi?: number | null };

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

/** "2,325 acres · 88 trails · 7 lifts · 301 in snow/yr" for the size tooltip. */
function sizeSummary(stats: ResortStats | undefined): string | undefined {
  if (!stats) return undefined;
  const parts = (
    [
      [stats.acres, "acres"],
      [stats.trails, "trails"],
      [stats.lifts, "lifts"],
      [stats.snowfallIn, "in snow/yr"],
      [stats.xcKm, "km XC"],
    ] as const
  )
    .filter(([n]) => n != null)
    .map(([n, label]) => `${n!.toLocaleString("en-US")} ${label}`);
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * Vertical drop from indyskipass.com, right-aligned, with the other size
 * figures on hover. A dash when the page lists none (most XC-only areas).
 */
function VerticalCell({ stats }: { stats: ResortStats | undefined }) {
  const vertical = stats?.verticalFt;
  return (
    <span
      className="block whitespace-nowrap text-right tabular-nums"
      title={sizeSummary(stats)}
    >
      {vertical == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <>
          {vertical.toLocaleString("en-US")}
          <span className="text-muted-foreground"> ft</span>
        </>
      )}
    </span>
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
    cell: ({ row }) => {
      const miles = row.original.distanceMi;
      if (miles == null) return row.original.state;
      // With miles alongside, long state values ("Lake Tahoe") truncate so
      // the table keeps its width.
      return (
        <span className="flex items-baseline whitespace-nowrap">
          <span className="max-w-[5.5rem] truncate" title={row.original.state}>
            {row.original.state}
          </span>
          <span className="ml-1 text-muted-foreground tabular-nums" title="Straight-line distance">
            {row.original.state ? "· " : ""}
            {Math.round(miles).toLocaleString("en-US")} mi
          </span>
        </span>
      );
    },
  },
  {
    // Sort-only: "Near me" sorts by this, and the miles show in the State
    // cell so the table doesn't grow a column. Always hidden.
    id: "distance",
    accessorFn: (row) => row.distanceMi ?? null,
    meta: { statusSortValue: (row) => row.distanceMi },
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
    id: "vertical",
    accessorFn: (row) => row.stats?.verticalFt ?? null,
    header: ({ column }) => <SortHeader label="Vert" column={column} descFirst />,
    cell: ({ row }) => <VerticalCell stats={row.original.stats} />,
    meta: { statusSortValue: (row) => row.stats?.verticalFt },
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
