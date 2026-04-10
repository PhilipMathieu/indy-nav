import { ClosingDatesTable } from "@/components/closing-dates-table";
import type { Mountain } from "@/lib/types";
import closingDates from "../../data/closing-dates.json";

export default function Home() {
  const mountains = closingDates as Mountain[];

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
      <footer className="mt-12 border-t pt-6 text-xs text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">How it works</p>
        <p>
          Closing dates are gathered automatically each morning by fetching
          mountain websites and using AI (Gemini Flash Lite) to extract season
          end dates. Dates with high confidence come from official announcements;
          medium and low confidence dates are inferred from schedules, snow
          reports, or web searches. High-confidence dates are locked in and not
          re-checked.
        </p>
        <p>
          This is an unofficial community tool and is not affiliated with Indy
          Pass. Always confirm with the mountain before making travel plans.
          {" "}
          <a
            href="https://github.com/PhilipMathieu/indy-nav"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Source on GitHub
          </a>
        </p>
        <a
          href="https://buymeacoffee.com/philipmathieu"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            src="https://img.buymeacoffee.com/button-api/?text=BUY%20ME%20A%20BREWSKI&emoji=%F0%9F%8D%BB&slug=philipmathieu&button_colour=E4312B&font_colour=000000&font_family=Lato&outline_colour=000000&coffee_colour=ffffff"
            alt="Buy Me a Brewski"
            className="mt-2"
          />
        </a>
      </footer>
    </main>
  );
}
