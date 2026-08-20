import type { FrameworkAdapter } from "@velloo/provider";

/**
 * MUI v6 provider — currently a **scaffold only**. The wizard and the
 * server's provider loader know about this id; the actual `@mui/material`
 * bundle, canvas-safe portal shims, and Pulse-MUI sample are deferred to
 * Sprint X+2.1.
 *
 * What's missing before this provider can be removed from the
 * deferred state:
 *
 *  1. Decide the bundling strategy. Either pre-build an ESM bundle of
 *     the MUI subset and ship it inside the velloo binary, or have the
 *     binary pull `@mui/material`@6 from npm at first init (slower
 *     onboarding, requires network). The plan recommends pre-bundle,
 *     and the install destination is `~/.velloo/providers/mui@6.0.0/`.
 *
 *  2. Author canvas-safe wrappers for the overlay components:
 *     `Dialog` / `Menu` / `Popover` / `Tooltip` / `Snackbar` swap
 *     `Portal` for an inline `<div>` and default `open` to true via
 *     `data-design-mode-open`. Mirror the pattern in
 *     `packages/shadcn-snapshot/src/components/canvas-portal.tsx`.
 *
 *  3. Author a `ThemeProvider` stub at iframe root. The stub takes
 *     Velloo's unified token tree (background, foreground, primary,
 *     primary-foreground, …) and produces a MUI `Theme` so `<Button
 *     color="primary">` etc. resolve to the design's colors. Defer
 *     `applyThemeTokens` until the provider interface gets the hook.
 *
 *  4. Build the manifest from MUI's `.d.ts` files (its types are
 *     well-documented, so this can be a one-time generator under
 *     `packages/provider-mui/build-manifest.ts`).
 *
 *  5. Port Pulse to MUI under `packages/cli/src/scaffold/pulse-mui/`.
 *     Each shadcn primitive maps to a MUI equivalent (`Card` → `Card`,
 *     `Button` → `Button` with `variant="contained"`, etc.). Same
 *     screens, MUI component IDs.
 *
 * See the Sprint X+1 sprint summary for
 * how this fits into the broader provider abstraction.
 */
export function createProvider(): FrameworkAdapter {
  throw new Error(
    [
      "velloo: the MUI provider (`@velloo/provider-mui`) is scaffolded but not yet vendored.",
      "Track this in docs/roadmap.md under Sprint X+2.1.",
      "Re-run `velloo init` with --library=shadcn-react or --library=none for now.",
    ].join("\n"),
  );
}

/** The id used in `Library.id` to select this provider. */
export const MUI_PROVIDER_ID = "mui" as const;
