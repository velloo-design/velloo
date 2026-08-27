# @velloo/provider-chakra

Chakra UI v2 provider for Velloo — a first-class `FrameworkAdapter`.

- **Real Chakra v2 components**, SSR'd in-process via a per-render emotion
  cache (`renderPass`, the same machinery as provider-mui); no client bundle
  needed.
- **`sx` channel** (`SX_PROP`) — chakra's native style prop rides the existing
  sx editor + `set_style` semantics; values take chakra theme tokens
  (`brand.500`, `chakra-body-bg`, spacing-scale numbers).
- **Canvas-safe overlays**: chakra's Modal/Drawer portal and SSR to nothing,
  and every overlay sub-part throws outside its parent's context — so
  `overlays.ts` shims the whole composition (Modal/Drawer/Popover/Menu/Tooltip
  + parts), rendered open + inline with chakra's composition ids intact so
  emitted code stays idiomatic.
- **Theme projection**: velloo tokens → `extendTheme` options
  (`chakraThemeOptions`) — a `brand` 50–900 scale derived from
  `colors.primary` in OKLCH (the primary lands verbatim at `brand.500`), real
  light/dark values on chakra's semantic tokens (`chakra-body-bg` …), radii and
  fonts; `emit_theme` writes a `chakra-theme.ts` `extendTheme(...)` module.
- **Codegen**: components emit as imports from `"@chakra-ui/react"`; the `sx`
  channel serializes verbatim.

`canvasBundleSpec` is deliberately absent in v1 — the server's emotion bundle
entry is MUI-styles-API-shaped (`ThemeProvider` + `createTheme`); chakra needs
`ChakraProvider` + `extendTheme` (see `src/index.ts`).
