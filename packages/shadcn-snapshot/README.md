# @velloo/shadcn-snapshot

> **Status — legacy.** This package is the pre-Sprint-Z provider, kept registered for back-compat with existing folders (`library.id: "shadcn-react"`). New folders default to [`@velloo/provider-shadcn-upstream`](../provider-shadcn-upstream/), which fetches vanilla shadcn from upstream at a pinned version and applies canvas-safe behavior through [`@velloo/shadcn-adapter`](../shadcn-adapter/). See `docs/decisions.md` #25 for the deprecation timeline.

The pinned shadcn component snapshot Velloo originally shipped with. **Components are embedded here, not in user design folders** (see `docs/decisions.md` #4 + #17).

Contents:

- `src/components/` — vendored shadcn primitives (button, card, input, …) plus Velloo wrappers (`Placeholder`, `Icon`, `Text`, `Heading`). Overlays use a canvas-safe contract (see `canvas-portal.tsx`): Portal/Content replaced with pinned-open inline `<div>`s so the design surface shows the styled state without escaping the iframe.
- `src/manifest.json` — built by `build.ts`; the prop descriptor data the inspector + MCP `list_components` consume. Includes categorized props (boolean, number, string, color, enum, icon) and cva variants.
- `snapshotVersion` — single source of truth for the version string the CLI stamps into `.design/config.json` at `velloo init`. Bumped whenever components are re-vendored from upstream shadcn. The Velloo canvas SPA (`@velloo/canvas`) re-vendors *real* shadcn from the same upstream pull on the same day and uses this same version stamp as its lockstep marker — see `docs/decisions.md` #18.

**Don't add components here casually.** Every new entry must pass the canvas-safe contract:

- No portals that escape the iframe.
- No router-required behavior.
- Stub providers for design mode (Dialog renders inline, Popover renders inline, etc.).
- Manifest entry with explicit prop categorization.

Build the manifest with `bun --cwd packages/shadcn-snapshot run build`.
