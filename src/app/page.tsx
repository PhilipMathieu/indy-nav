import { readFileSync } from "fs";
import { join } from "path";
import { ClosingDatesTable } from "@/components/closing-dates-table";
import type { Mountain } from "@/lib/types";

function loadMountains(): Mountain[] {
  try {
    const filePath = join(process.cwd(), "data", "closing-dates.json");
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export default function Home() {
  const mountains = loadMountains();

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Indy Nav
        </h1>
        <p className="text-sm text-muted-foreground">
          Northeast Indy Pass closing dates — 2025/2026 season
        </p>
      </div>
      <ClosingDatesTable mountains={mountains} />
    </main>
  );
}
