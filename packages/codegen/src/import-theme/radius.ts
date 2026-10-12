import type { Theme } from "@velloo/schema";
import type { ParsedThemeCss } from "./parse-css.ts";

type Radius = Theme["radius"];

/**
 * The corner scale a theme has once a stylesheet is imported into it.
 *
 * `--radius` is the base every other step derives from, so a sheet that states
 * it replaces the scale instead of patching one step: steps left over from the
 * theme's previous radius would keep `rounded-lg` and `rounded-xl` where they
 * were while the base moved — a square app drawn with rounded cards. What
 * remains is the base alone, which the renderer and the emitters hang the
 * shadcn ladder off. `none` and `full` are not sizes on that ladder and stay.
 *
 * Steps the sheet names itself go on top either way. `md` holds the base and
 * is also a step, so a sheet that names both has `lg` pinned to the base — in
 * the shadcn convention `--radius` is the `lg` step — which keeps the theme
 * read as a scale and its `md` as written.
 */
export function importedRadius(
  current: Radius,
  parsed: Pick<ParsedThemeCss, "radius" | "radiusScale">,
): Radius {
  const steps = parsed.radiusScale ?? {};
  if (parsed.radius === undefined) return { ...current, ...steps };
  return {
    ...(current.none !== undefined ? { none: current.none } : {}),
    ...(current.full !== undefined ? { full: current.full } : {}),
    md: parsed.radius,
    ...(steps.md !== undefined ? { lg: parsed.radius } : {}),
    ...steps,
  };
}
