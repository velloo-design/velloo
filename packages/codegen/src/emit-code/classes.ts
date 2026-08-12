import { twMerge } from "tailwind-merge";

/**
 * Merge a list of className fragments via tailwind-merge to drop semantically
 * conflicting duplicates (e.g. `bg-red-500 bg-blue-500` → `bg-blue-500`).
 * Empty fragments are ignored. Ordering is finalized later by Biome's
 * `useSortedClasses` pass over the whole file.
 */
export function mergeClasses(...fragments: Array<string | undefined>): string {
  const joined = fragments
    .filter((f): f is string => typeof f === "string" && f.length > 0)
    .join(" ");
  return twMerge(joined).trim();
}
