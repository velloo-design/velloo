# @velloo/shadcn-snapshot

> **Status — internal.** This package is the **canvas design-mode runtime for `shadcn-upstream`** — not a user-facing provider. Since design-folder format v2, `shadcn-react` is no longer a selectable library id (existing folders migrate to `shadcn-upstream` via the config shim); [`@velloo/provider-shadcn-upstream`](../provider-shadcn-upstream/) reuses this package's registry, entry CSS, and manifest so the canvas renders canvas-safe shadcn without bundling 25+ `@radix-ui/*` packages. A real vanilla-shadcn install in the user's app is delegated to `npx shadcn@latest add` at agent handoff. The internal `id: "shadcn-react"` remains as the provider's self-identity string only.

The pinned shadcn component snapshot. **Components are embedded here, not in user design folders.**

Contents:

- `src/components/ui/` — vendored shadcn primitives (button, card, input, …), pulled from upstream's registry by `vendor.ts`.
- `src/shadcn-tailwind.css` — upstream's own shared stylesheet, vendored alongside the components: the `data-open` / `data-closed` / `data-checked` custom variants the registry's components are written against. `src/tailwind-entry.css` imports it plus `tw-animate-css`, then layers Velloo's force-state variants on top.
- The framework-neutral velloo helpers (`Box`, `Heading`, `Text`, `Prose`, `Icon`, `Image`, `SVG`, `Layer`, `Divider`, `Gradient`, `Placeholder`) live in [`@velloo/helpers`](../helpers/); this registry includes all eleven, and `build.ts` splices their canonical descriptors into the generated manifest.
- `dist/manifest.json` — built by `build.ts`; the prop descriptor data the inspector + MCP `list_components` consume. Includes categorized props (boolean, number, string, color, enum, icon) and cva variants.
- `snapshotVersion` — records which upstream shadcn pull the vendored components mirror; bumped whenever they're re-vendored. `shadcnStyle` and `shadcnCliVersion` record which registry style and CLI release that pull came from. The Velloo canvas SPA (`@velloo/canvas`) re-vendors *real* shadcn from the same upstream pull on the same day and uses this same version stamp as its lockstep marker.

## Re-vendoring

```bash
bun run --cwd packages/shadcn-snapshot vendor        # all components + upstream CSS
bun run --cwd packages/shadcn-snapshot vendor button # or just some
bun run --cwd packages/shadcn-snapshot build         # regenerate dist/manifest.json
```

The registry serves each style's components with the `cn-*` semantic classes already flattened into Tailwind utilities, so what lands here is the same shape a user's `shadcn add` writes. `vendor.ts` rewrites upstream's `@/registry/…` imports to relative paths and collapses upstream's icon-library-agnostic `<IconPlaceholder>` to lucide. Bump `snapshotVersion` after a pull.

Some components can't be taken verbatim; `vendor.ts`'s `ADAPTED` set names them and **skips them on a routine pull**, so a re-vendor can't silently revert a shim. `--force` overwrites one deliberately, and then the adaptation has to go back on by hand. Three kinds live there:

- **Overlays** — Portal/Content replaced with pinned-open inline `<div>`s (see `canvas-portal.tsx`) so the design surface shows the styled state without escaping the iframe.
- **Static state** — a design ships `checked` / `value` / `open` with no handler, which React treats as a controlled component it can never update. These promote it to the uncontrolled equivalent, and open collapsed containers so their styling is visible without interaction.
- **JSON-shaped props** — a design carries scalars, so `Calendar` takes an ISO date string where react-day-picker wants a `Date`. `Chart` stays on echarts because recharts renders nothing under static SSR.

**Don't add components here casually.** Every new entry must pass the canvas-safe contract:

- No portals that escape the iframe.
- No router-required behavior.
- Stub providers for design mode (Dialog renders inline, Popover renders inline, etc.).
- Manifest entry with explicit prop categorization.
