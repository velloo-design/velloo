import { creditAmount } from "@velloo/protocol";
import { Coins } from "lucide-react";
import { cn } from "../lib/utils.ts";

/**
 * A credit amount the way the canvas shows one: the coins mark in front of the
 * number, where a currency sign would go. The word stays for screen readers.
 */
export function Credits({ micros, className }: { micros: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 tabular-nums", className)}>
      <Coins aria-hidden="true" className="size-[1.1em] shrink-0" />
      {creditAmount(micros)}
      <span className="sr-only"> credits</span>
    </span>
  );
}

/** At or under this the cloud sends its low-credits notice (5,000 credits). */
const LOW_MICROS = 5_000_000;
/** Under this a balance buys only a handful of images. */
const EMPTY_MICROS = 100_000;

/** How full a balance is, by the same line the cloud's low-credits notice uses. */
export function creditLevel(micros: number): "plenty" | "low" | "empty" {
  if (micros < EMPTY_MICROS) return "empty";
  if (micros <= LOW_MICROS) return "low";
  return "plenty";
}

/** Important, so a menu row's highlight doesn't wash the level out while it's hovered. */
export const CREDIT_LEVEL_CLASS: Record<ReturnType<typeof creditLevel>, string> = {
  plenty: "text-emerald-600! dark:text-emerald-500!",
  low: "text-amber-600! dark:text-amber-400!",
  empty: "text-destructive!",
};
