/**
 * Per-shadcn-component strategy declaring how the upstream provider's
 * bundler should treat the upstream source file. Three strategies:
 *
 *   - `passthrough`: the upstream component is canvas-safe on its own
 *     (no portals, no required runtime state). Re-export the file as
 *     fetched from `shadcn-ui/ui`. Most components fall here.
 *
 *   - `replace`: the upstream component isn't canvas-safe. The bundler
 *     ignores the fetched file and exports the corresponding adapter
 *     module (`./components/<id>.tsx`) instead. Used for overlays
 *     (Dialog, Popover, …) where the Portal escapes the iframe, and
 *     for runtime-heavy components (Calendar, Chart, Carousel) we
 *     ship static fakes for.
 *
 *   - `wrap` *(reserved, unused for now)*: future-proofing for cases
 *     where the upstream is mostly fine but needs a small runtime tweak
 *     applied at the import boundary. None today.
 *
 * Anything NOT listed here is assumed `passthrough` — keeping the map
 * small to the actual exceptions makes it easy to spot whether a new
 * shadcn release adds a portal-bearing component we need to adapt.
 *
 * The id key matches the shadcn registry name (lowercase, hyphenated):
 * `dropdown-menu`, `alert-dialog`, etc. The bundler converts these to
 * PascalCase component ids (`DropdownMenu`, `AlertDialog`) per the
 * standard shadcn convention.
 */

export type AdaptationStrategy = { kind: "passthrough" } | { kind: "replace"; module: string };

/**
 * Stable mapping. Update when:
 * - upstream shadcn ships a new portal-bearing component we need to wrap
 * - upstream replaces a portal-using component with a non-portal one
 *   (we'd promote that id back to passthrough)
 */
export const ADAPTATION_MAP: Record<string, AdaptationStrategy> = {
  // Overlays: every one of these uses Radix's Portal in the upstream
  // source, which escapes the canvas iframe. Replace with the inline
  // adapter that renders Content under the trigger.
  dialog: { kind: "replace", module: "./components/dialog.tsx" },
  "alert-dialog": { kind: "replace", module: "./components/alert-dialog.tsx" },
  sheet: { kind: "replace", module: "./components/sheet.tsx" },
  popover: { kind: "replace", module: "./components/popover.tsx" },
  "dropdown-menu": { kind: "replace", module: "./components/dropdown-menu.tsx" },
  select: { kind: "replace", module: "./components/select.tsx" },
  tooltip: { kind: "replace", module: "./components/tooltip.tsx" },

  // Toaster: the real `sonner` component mounts an imperative queue +
  // portal. In design mode there's nothing dispatching toast() so we
  // render a static sample toast for the user to style.
  sonner: { kind: "replace", module: "./components/sonner.tsx" },

  // Runtime-heavy: full static fakes. The user's app keeps the real
  // implementations (react-day-picker, recharts, embla-carousel-react);
  // codegen emits imports from those, the canvas just shows a styled
  // approximation.
  calendar: { kind: "replace", module: "./components/calendar.tsx" },
  chart: { kind: "replace", module: "./components/chart.tsx" },
  carousel: { kind: "replace", module: "./components/carousel.tsx" },
};

/**
 * Tell the bundler what to do with a given shadcn registry id. Returns
 * `{ kind: "passthrough" }` for any id not explicitly listed.
 */
export function strategyFor(id: string): AdaptationStrategy {
  return ADAPTATION_MAP[id] ?? { kind: "passthrough" };
}

/**
 * Ids the adapter package provides replacement modules for. The
 * upstream provider's installer uses this list to ensure all referenced
 * adapters can resolve at bundle time.
 */
export function replacementIds(): string[] {
  return Object.entries(ADAPTATION_MAP)
    .filter(([, s]) => s.kind === "replace")
    .map(([id]) => id)
    .sort();
}
