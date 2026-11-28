"use client";

import * as React from "react";
import { format } from "date-fns";
import { CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DateFilterProps {
  date: Date | undefined;
  onDateChange: (date: Date | undefined) => void;
}

export function DateFilter({ date, onDateChange }: DateFilterProps) {
  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <span className="shrink-0 text-sm text-muted-foreground">Open as of:</span>
      <Popover>
        <PopoverTrigger
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-9 min-w-0 flex-1 justify-start text-left font-normal sm:h-8 sm:w-[200px] sm:flex-none",
            !date && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, "MMM d, yyyy") : "Today"}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={onDateChange}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      {date && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDateChange(undefined)}
          className="h-9 w-9 shrink-0 sm:h-8 sm:w-8"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Clear date filter</span>
        </Button>
      )}
    </div>
  );
}
