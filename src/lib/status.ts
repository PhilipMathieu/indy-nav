import { isBefore, isAfter, parseISO, startOfDay } from "date-fns";
import type { Mountain } from "./types";
import { getSeason } from "./season";

export type MountainStatus = "open" | "opening-soon" | "unknown" | "closed";

export const STATUS_LABEL: Record<MountainStatus, string> = {
  open: "Open",
  "opening-soon": "Opening soon",
  unknown: "Unknown",
  closed: "Closed",
};

/**
 * Work out whether a mountain is open on `asOfDate`.
 *
 * - closed: the closing date has passed.
 * - opening-soon: the opening date is still ahead.
 * - open: the opening date has passed and the closing date hasn't (or is
 *   unknown).
 * - With no opening date but a closing date still ahead, the mountain counts
 *   as open from January 1 of the season's second year (nearly every area
 *   with a published closing date is running by then) and unknown before.
 * - unknown: anything else.
 */
export function getMountainStatus(mountain: Mountain, asOfDate: Date): MountainStatus {
  const day = startOfDay(asOfDate);
  const closing = mountain.closingDate ? parseISO(mountain.closingDate) : null;
  const opening = mountain.openingDate ? parseISO(mountain.openingDate) : null;

  if (closing && isBefore(closing, day)) return "closed";
  if (opening && isAfter(opening, day)) return "opening-soon";
  if (opening) return "open";
  if (closing) {
    const midSeason = new Date(getSeason(day).endYear, 0, 1);
    return isBefore(day, midSeason) ? "unknown" : "open";
  }
  return "unknown";
}

/**
 * Default table order: open (soonest closing first), opening soon (soonest
 * opening first), unknown (by name), then closed (latest closing first).
 */
export function groupAndSort<T extends Mountain>(
  mountains: T[],
  asOfDate: Date
): T[] {
  const groups: Record<MountainStatus, T[]> = {
    open: [],
    "opening-soon": [],
    unknown: [],
    closed: [],
  };
  for (const m of mountains) groups[getMountainStatus(m, asOfDate)].push(m);

  const byDate =
    (key: "openingDate" | "closingDate", dir: 1 | -1) => (a: T, b: T) => {
      const x = a[key];
      const y = b[key];
      if (!x && !y) return a.name.localeCompare(b.name);
      if (!x) return 1;
      if (!y) return -1;
      return dir * x.localeCompare(y);
    };

  groups.open.sort(byDate("closingDate", 1));
  groups["opening-soon"].sort(byDate("openingDate", 1));
  groups.unknown.sort((a, b) => a.name.localeCompare(b.name));
  groups.closed.sort(byDate("closingDate", -1));

  return [...groups.open, ...groups["opening-soon"], ...groups.unknown, ...groups.closed];
}

const STATUS_RANK: Record<MountainStatus, number> = {
  open: 0,
  "opening-soon": 1,
  unknown: 2,
  closed: 3,
};

/**
 * Sort by a number while keeping the status groups in place: open first,
 * then opening soon, unknown and closed. Within each group rows go by
 * `value` (descending when `desc`), with missing values last. This is what
 * makes "biggest mountain open on Dec 23" or "nearest open mountain" read
 * straight off the top of the table.
 */
export function sortWithinStatus<T extends { status: MountainStatus; name: string }>(
  rows: T[],
  value: (row: T) => number | null | undefined,
  desc: boolean
): T[] {
  return [...rows].sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rank !== 0) return rank;
    const x = value(a);
    const y = value(b);
    if (x == null && y == null) return a.name.localeCompare(b.name);
    if (x == null) return 1;
    if (y == null) return -1;
    return desc ? y - x : x - y;
  });
}
