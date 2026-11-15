import type { ContrastPair } from "@velloo/protocol";
import { Info } from "lucide-react";
import { Badge } from "../ui/badge.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip.tsx";

/** Under AA for body text: what the agent is asked to fix and the person should know about. */
const failing = (p: ContrastPair) => p.tier === "Fail" || p.tier === "AAlarge";

const ABOUT =
  "Each text-on-background pair the components use (foreground on background, primary-foreground on primary, muted-foreground on muted, …), in light and dark, checked against WCAG AA: 4.5:1 for text, 3:1 for large text and UI. The badge counts the pairs below 4.5:1 in the scheme shown.";

/**
 * A proposal's colour pairs in one scheme, scored, under a header that says
 * what is checked. The badge counts what the list shows, so switching to
 * dark recounts.
 */
export function ContrastSummary({
  pairs,
  scheme,
}: {
  /** Every scored pair, both schemes; null while they are being scored. */
  pairs: ContrastPair[] | null;
  scheme: "light" | "dark";
}) {
  const shown = pairs?.filter((p) => p.mode === scheme) ?? [];
  const under = shown.filter(failing).length;
  return (
    <section aria-label="Contrast" data-contrast={scheme} className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <h4 className="text-xs font-medium">Contrast</h4>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="What the contrast check covers"
                className="text-muted-foreground hover:text-foreground"
              >
                <Info className="size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{ABOUT}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {pairs === null ? null : under > 0 ? (
          <Badge variant="destructive">
            {under} {under === 1 ? "pair" : "pairs"} under AA in {scheme}
          </Badge>
        ) : shown.length > 0 ? (
          <Badge variant="secondary">Every {scheme} pair passes AA</Badge>
        ) : null}
      </div>
      {shown.length > 0 ? (
        <ul
          aria-label={`Contrast, ${scheme}`}
          className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2"
        >
          {shown.map((p) => (
            <li
              key={p.label}
              data-tier={p.tier}
              className={`flex items-center gap-2 ${failing(p) ? "text-destructive" : ""}`}
            >
              <span className="flex shrink-0">
                <span
                  className="size-3 rounded-sm ring-1 ring-border"
                  style={{ background: p.bg }}
                />
                <span
                  className="-ml-1 size-3 rounded-sm ring-1 ring-border"
                  style={{ background: p.fg }}
                />
              </span>
              <span className="min-w-0 flex-1 truncate">{p.label}</span>
              <span className="tabular-nums">{p.ratio.toFixed(2)}:1</span>
              <span className="w-12 text-right font-medium">
                {p.tier === "AAlarge" ? "AA large" : p.tier}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
