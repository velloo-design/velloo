import { mergeTailwind } from "@velloo/helpers";

/**
 * Merge a list of className fragments via tailwind-merge to drop semantically
 * conflicting duplicates (e.g. `bg-red-500 bg-blue-500` → `bg-blue-500`).
 * Empty fragments are ignored. Order is the order they were written in: no
 * sorting pass runs over the emitted string, so what comes out here is what
 * the agent reads.
 *
 * Uses velloo's configured merge, not the stock one, so the theme-generated
 * typeset utilities are grouped correctly — otherwise `text-h1` would read as a
 * color and emitted code would disagree with what the canvas painted.
 */
export function mergeClasses(...fragments: Array<string | undefined>): string {
  const joined = fragments
    .filter((f): f is string => typeof f === "string" && f.length > 0)
    .join(" ");
  return mergeTailwind(joined).trim();
}
