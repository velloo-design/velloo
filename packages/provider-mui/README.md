# @velloo/provider-mui

Scaffold-only Material UI v6 provider. The package, the loader
registration, and the wizard branch all exist; the actual MUI runtime
bundle is **deferred to Sprint X+2.1**.

This package is in the repo today so:

- The `ComponentProvider` interface in `@velloo/provider` is exercised
  against a non-shadcn shape (any divergence the MUI scaffold needs
  surfaces now, not at the moment we bring MUI in).
- The wizard's library selector and the server's provider loader have
  a concrete `"mui"` registration to wire against. The current factory
  throws a clear "not yet vendored" error so users get a helpful
  message rather than a cryptic `UnknownProviderError`.
- The README captures the contract a future MUI implementation must
  satisfy.

## What an actual MUI provider needs

Verbatim from the source comment in `src/index.ts`:

1. **Bundling strategy.** Pre-build an ESM bundle of a ~30-40-component
   MUI subset (Button, Card, TextField, Select, Dialog, Menu, Tabs,
   Accordion, Snackbar, Stepper, …) and ship it inside the velloo
   binary, or install `@mui/material@6` from npm at first init. The
   plan recommends pre-bundle; install destination
   `~/.velloo/providers/mui@6.0.0/`.

2. **Canvas-safe portal shims.** `Dialog`, `Menu`, `Popover`,
   `Tooltip`, `Snackbar` need their `Portal` swapped for an inline
   `<div>` and `open` defaulted to true via `data-design-mode-open`.
   Mirrors the pattern in
   `packages/shadcn-snapshot/src/components/canvas-portal.tsx`.

3. **ThemeProvider stub.** A canvas-mode-only `<ThemeProvider>` that
   takes Velloo's token tree (background, foreground, primary,
   primary-foreground, …) and produces a MUI `Theme` so
   `<Button color="primary">` resolves to the design's colors. This
   will likely require an extension to the `ComponentProvider`
   interface (e.g. an optional `applyThemeTokens` hook returning CSS
   variables the iframe's `<head>` injects).

4. **Manifest from `.d.ts`.** A one-shot build script that walks
   MUI's TypeScript declaration files via ts-morph (same shape as
   `packages/shadcn-snapshot/build.ts`) and produces a manifest under
   `packages/provider-mui/dist/manifest.json`.

5. **Pulse-MUI sample.** Port the seven Pulse screens to MUI component
   ids under `packages/cli/src/scaffold/pulse-mui/`. Same screens, MUI
   primitives.

## Open contract questions

These will be resolved during X+2.1 implementation but pinning them
here for posterity:

- Where do `className` overrides land? MUI accepts both `className`
  (DOM passthrough) and `sx` (theme-aware style props). Tailwind
  classes work via `className`. Codegen will need to know which path
  to use per prop — likely `className` for canvas overrides and `sx`
  for theme-derived values.
- How does MUI's emotion CSS-in-JS coexist with the embedded
  Tailwind v4 JIT? The iframe needs both — emotion injects a `<style>`
  tag at runtime, Tailwind's compiled CSS comes in via the renderer's
  `snapshotCss`. They don't conflict; the iframe just ends up with two
  style sources, which is fine.
- Does MUI v6 + React 19 work? Need to verify before vendoring.

## Until then

Run `velloo init --library=shadcn-react` (the default, polished
end-to-end) or `velloo init --library=none` (bare primitives, ships
today). Both exercise the same `ComponentProvider` interface this
package will eventually plug into.
