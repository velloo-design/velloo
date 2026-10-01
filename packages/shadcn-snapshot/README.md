# @velloo/shadcn-snapshot

> **Status — internal.** This package is the **canvas design-mode runtime for `shadcn-upstream`** — not a user-facing provider. Since design-folder format v2, `shadcn-react` is no longer a selectable library id (existing folders migrate to `shadcn-upstream` via the config shim); [`@velloo/provider-shadcn-upstream`](../provider-shadcn-upstream/) reuses this package's registry, entry CSS, and manifest so the canvas renders canvas-safe shadcn without bundling 25+ `@radix-ui/*` packages. A real vanilla-shadcn install in the user's app is delegated to `npx shadcn@latest add` at agent handoff. The internal `id: "shadcn-react"` remains as the provider's self-identity string only.

The pinned shadcn component snapshot. **Components are embedded here, not in user design folders.**

Contents:

- `src/components/ui/` — vendored shadcn primitives (button, card, input, …), pulled from upstream's registry by [`scripts/vendor-shadcn/`](../../scripts/vendor-shadcn/), the one pipeline that vendors shadcn into this repo.
- `src/shadcn-tailwind.css` — upstream's own shared stylesheet, vendored alongside the components: the `data-open` / `data-closed` / `data-checked` custom variants the registry's components are written against. `src/tailwind-entry.css` imports it plus `tw-animate-css`, then layers Velloo's force-state variants on top.
- The framework-neutral velloo helpers (`Box`, `Heading`, `Text`, `Prose`, `Icon`, `Image`, `SVG`, `Layer`, `Divider`, `Gradient`, `Placeholder`) live in [`@velloo/helpers`](../helpers/); this registry includes all eleven, and `build.ts` splices their canonical descriptors into the generated manifest.
- `dist/manifest.json` — built by `build.ts`; the prop descriptor data the inspector + MCP `list_components` consume. Includes categorized props (boolean, number, string, color, enum, icon) and cva variants.
- `snapshotVersion`, `shadcnStyle`, `shadcnCliVersion` — the pull, the registry style and the CLI release the components came from. All three are **stamped by the pull**, not hand-edited: the one source is `SHADCN_PIN` in `scripts/vendor-shadcn/pipeline.ts`, and the style and CLI fields land in `@velloo/canvas`'s package.json from the same run, which is what keeps the IDE chrome's copy of *real* shadcn on the same pull as this one. `snapshotVersion` is read back as the shadcn provider's version.

## Re-vendoring

```bash
bun run vendor                                # both copies + upstream CSS
bun run vendor --target=snapshot button       # just some of this one, while the pin holds
bun run --cwd packages/shadcn-snapshot build  # regenerate dist/manifest.json
```

The registry serves each style's components with the `cn-*` semantic classes already flattened into Tailwind utilities, so what lands here is the same shape a user's `shadcn add` writes. The pipeline rewrites upstream's utils import (a bare `from "cn"`) and its `@/registry/…` sibling imports to relative paths, and collapses upstream's icon-library-agnostic `<IconPlaceholder>` to lucide. To move the pull, bump `SHADCN_PIN` and run `bun run vendor` — the stamps here follow, and a narrower pull is refused until they do.

What this package carries is the `snapshot` target's `catalog` in `scripts/vendor-shadcn/targets.ts`, which is complete: a component upstream serves that isn't there is in the same file's `skipped` map with its reason, and the pull fails if upstream adds one that's in neither.

Some components can't be taken verbatim; the target's `adapted` set names them and **skips them on a routine pull**, so a re-vendor can't silently revert a shim. `--force` overwrites one deliberately, and then the adaptation has to go back on by hand. Three kinds live there:

- **Overlays** — Portal/Content replaced with pinned-open inline `<div>`s (see `canvas-portal.tsx`) so the design surface shows the styled state without escaping the iframe.
- **Static state** — a design ships `checked` / `value` / `open` with no handler, which React treats as a controlled component it can never update. These promote it to the uncontrolled equivalent, and open collapsed containers so their styling is visible without interaction.
- **JSON-shaped props** — a design carries scalars, so `Calendar` takes an ISO date string where react-day-picker wants a `Date`. `Chart` stays on echarts because recharts renders nothing under static SSR.

**Don't add components here casually.** Every new entry must pass the canvas-safe contract:

- No portals that escape the iframe.
- No router-required behavior.
- Stub providers for design mode (Dialog renders inline, Popover renders inline, etc.).
- Manifest entry with explicit prop categorization.
