# @velloo/shadcn-snapshot

> **Status — internal.** This package is the **canvas design-mode runtime for `shadcn-upstream`** — not a user-facing provider. Since design-folder format v2, `shadcn-react` is no longer a selectable library id (existing folders migrate to `shadcn-upstream` via the config shim); [`@velloo/provider-shadcn-upstream`](../provider-shadcn-upstream/) reuses this package's registry, entry CSS, and manifest so the canvas renders canvas-safe shadcn without bundling 25+ `@radix-ui/*` packages. A real vanilla-shadcn install in the user's app is delegated to `npx shadcn@latest add` at agent handoff. The internal `id: "shadcn-react"` remains as the provider's self-identity string only.

The pinned shadcn component snapshot. **Components are embedded here, not in user design folders.**

Contents:

- `src/components/ui/` — vendored shadcn primitives (button, card, input, …). Overlays use a canvas-safe contract (see `canvas-portal.tsx`): Portal/Content replaced with pinned-open inline `<div>`s so the design surface shows the styled state without escaping the iframe. Calendar / Chart / Carousel are static fakes for the same reason.
- The framework-neutral velloo helpers (`Box`, `Heading`, `Text`, `Icon`, `Image`, `SVG`, `Layer`, `Divider`, `Gradient`, `Placeholder`) live in [`@velloo/helpers`](../helpers/); this registry includes all ten, and `build.ts` splices their canonical descriptors into the generated manifest.
- `dist/manifest.json` — built by `build.ts`; the prop descriptor data the inspector + MCP `list_components` consume. Includes categorized props (boolean, number, string, color, enum, icon) and cva variants.
- `snapshotVersion` — records which upstream shadcn pull the vendored components mirror; bumped whenever they're re-vendored. The Velloo canvas SPA (`@velloo/canvas`) re-vendors *real* shadcn from the same upstream pull on the same day and uses this same version stamp as its lockstep marker.

**Don't add components here casually.** Every new entry must pass the canvas-safe contract:

- No portals that escape the iframe.
- No router-required behavior.
- Stub providers for design mode (Dialog renders inline, Popover renders inline, etc.).
- Manifest entry with explicit prop categorization.

Build the manifest with `bun --cwd packages/shadcn-snapshot run build`.
