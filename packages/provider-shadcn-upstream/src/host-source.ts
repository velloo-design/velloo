import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Whether `source` exports a binding named `id`.
 *
 * Apps routinely rename shadcn primitives when they fork them — a local
 * `card.tsx` exports `Panel`, its `badge.tsx` exports `StatusChip`. The family
 * FILE is still there and still compiles, so file-existence alone wrongly reads
 * as "the app has this component": the canvas would import it, `pick` would
 * find no such export and hand React the module namespace object, and the whole
 * screen would fall back to SSR *after* `component_status` promised `exact`.
 *
 * Deliberately a scan, not a parser: it recognizes the shapes shadcn files
 * actually use and treats a wildcard re-export as "can't tell" (permissive, so
 * a barrel file isn't wrongly rejected).
 */
export function exportsName(source: string, id: string): boolean {
  const name = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declared = new RegExp(
    `\\bexport\\s+(?:async\\s+)?(?:function|const|let|var|class)\\s+${name}\\b`,
  );
  if (declared.test(source)) return true;
  // `export { Button, buttonVariants }` / `export { Chip as Badge }` / `export { X } from "./y"`
  for (const match of source.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    const clause = match[1] ?? "";
    for (const part of clause.split(",")) {
      const local = part.trim().split(/\s+as\s+/);
      const exported = (local.length > 1 ? local[1] : local[0])?.trim();
      if (exported === id) return true;
    }
  }
  return /\bexport\s+\*\s+from\b/.test(source);
}

/** The host file for a shadcn family that actually exports `id`, or null. */
export function hostComponentFile(uiDir: string, addName: string, id: string): string | null {
  for (const extension of ["tsx", "ts", "jsx", "js"]) {
    const path = join(uiDir, `${addName}.${extension}`);
    if (!existsSync(path)) continue;
    try {
      return exportsName(readFileSync(path, "utf8"), id) ? path : null;
    } catch {
      return null;
    }
  }
  return null;
}
