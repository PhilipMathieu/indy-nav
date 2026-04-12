"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow, format, parseISO } from "date-fns";
import type { Mountain } from "@/lib/types";

const confidenceVariant: Record<
  Mountain["closingDateConfidence"],
  "default" | "secondary" | "destructive"
> = {
  high: "default",
  medium: "secondary",
  low: "destructive",
};

export const columns: ColumnDef<Mountain>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Mountain
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
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
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        State
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
  },
  {
    accessorKey: "closingDate",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Closing Date
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const date = row.getValue("closingDate") as string | null;
      if (!date) return <span className="text-muted-foreground">Unknown</span>;
      return format(parseISO(date), "MMM d, yyyy");
    },
    sortingFn: (rowA, rowB) => {
      const a = rowA.original.closingDate;
      const b = rowB.original.closingDate;
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    },
  },
  {
    accessorKey: "closingDateConfidence",
    header: "Confidence",
    cell: ({ row }) => {
      const confidence = row.getValue(
        "closingDateConfidence"
      ) as Mountain["closingDateConfidence"];
      return (
        <Badge variant={confidenceVariant[confidence]}>{confidence}</Badge>
      );
    },
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
