# @velloo/provider-mui

The Material UI v6 **`FrameworkAdapter`** — a fully framework-native library
adapter. A folder that targets `mui` renders, styles, and emits **real Material
UI**, not a shadcn/Tailwind imitation.

`createProvider()` returns a working adapter; the server registers it in
`packages/server/src/providers.ts` and `velloo init --library=mui` scaffolds a
MUI folder.

## What it ships

- **Real components, SSR'd in-process.** `registry` maps design `$ref` ids to
  actual `@mui/material` components (Box, Stack, Container, Paper, Card, Typography,
  Button, TextField, Chip, Divider, Tabs, Table\*, Alert, …). MUI + emotion are
  pre-bundled velloo deps pinned to the monorepo React (no dual-React hazard), so
  `renderToString` produces genuine MUI markup. `renderPass(theme)` wraps the tree
  in an emotion `CacheProvider` (key `vmui`) + MUI `ThemeProvider` and extracts the
  critical CSS the renderer injects as `<style data-velloo-adapter>`.
- **Canvas-safe overlays.** `Dialog`/`Menu`/`Popover`/`Drawer`/`Snackbar`
  (`overlays.ts`) render their surface **open + inline** (no escaping portal, no
  fixed backdrop) so a screenshot shows them; the sub-parts (`DialogTitle`/`Content`/
  `Actions`) are MUI's real inline components.
- **`sx` style channel.** `styleChannel = SX_PROP` — the agent's `set_style` and the
  canvas inspector edit an `sx` object, not Tailwind classes.
- **Theme projection (both ways).** `muiThemeOptions` projects velloo's token tree
  onto MUI `ThemeOptions` (oklch→rgb via culori, since MUI's color manipulator can't
  parse oklch) — the single source used by both the render pass and codegen.
  `themeToNative` exposes it; `importThemeFromMui` (in `@velloo/cli`) reads a MUI
  app's `createTheme(...)` back into velloo tokens.
- **Native codegen.** `codegenModule = "@mui/material"` drives a `CodegenTarget` so
  `emit_code` emits `<Component sx={{…}} />` from `@mui/material`; `emit_theme`
  emits a `createTheme(...)` module.
- **Catalog + canvas bundle.** `catalog()` (every component installed, from
  `@mui/material`) backs `install_component`; `canvasBundleSpec` lets the server
  bundle the host app's *exact installed* MUI from `node_modules` and client-mount
  it over the SSR (`packages/server/src/live/canvas-bundle.ts`).

## Manifest

`MUI_MANIFEST` (`manifest.ts`) is curated by hand — focused on the props an agent
actually sets (variant/color/size, `sx`, children) — chosen over a noisy generated
dump of MUI's vast `.d.ts` surface.

## Notes

- The hand-vendored MUI in this package's `node_modules` is what the canvas SSRs by
  default; when the host app has its own `@mui/material`, the per-folder canvas
  bundle client-mounts that exact version (existing-project flow). Emitted code needs
  `@mui/material @emotion/react @emotion/styled` in the user's app — the init README
  hands that off.
- Verified end-to-end: a sonnet-4.6 eval reverse-engineers a MUI dashboard natively
  at ~90% fidelity, and a headless-chromium test confirms the installed-component
  mount.
