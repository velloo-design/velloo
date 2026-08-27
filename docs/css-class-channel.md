# The `css-class` style channel — theme-generated classes for no-Tailwind folders

Status: **adopted** (2026-07-09, follow-up to the pre-OSS architecture audit).
Implementation is not scheduled yet — this document is the design of record for when it is.

## Problem

A `none/none` folder (no-framework library, no CSS framework) styles exclusively through
inline `style` objects that read the CSS variables `themeToCss` injects. That channel has a
functional hole, not just an ergonomic one:

1. **Inline styles cannot express `:hover` / `:focus-visible` / `:active` or media queries.**
   A none/none design literally cannot have a hover state or a responsive rule today, on the
   canvas or in emitted code.
2. **Emitted markup is noisy.** `style={{…}}` blocks on every node read worse than class-based
   HTML for exactly the audience this mode serves (simple sites without a build step).
3. **Theme changes touch every node.** Restyling flows through per-node inline values instead
   of one stylesheet.

## Decision

Adopt a third channel for the `none` provider: **`css-class`** — a bounded set of semantic CSS
classes generated from the folder's theme tokens. Explicitly **not** an arbitrary utility
system: no numeric scales beyond what the theme declares, no variant prefixes, no JIT. That
would be reinventing Tailwind; a folder that wants utilities should pick `none/tailwind`.

The three-layer styling story for a `none/classes` folder:

| Layer | Owner | Use |
|---|---|---|
| Generated semantic classes | theme → `themeToClassesCss` | the common case: layout, color, type, spacing |
| `theme/custom.css` | user/agent (existing escape hatch) | bespoke rules, node-specific states, keyframes |
| inline `style` | node props (existing `style` channel prop) | one-off values with no semantic meaning |

## Channel mechanics

- New `StyleChannelKind: "css-class"` with `prop: "className"`, `needsTailwindJit: false`,
  `editorLabel: "Classes"`. The payload prop is `className`, but the vocabulary is the
  generated inventory — `validate_classes` gets a channel-aware analog that checks against the
  inventory instead of the Tailwind JIT.
- `CssFramework` gains `"classes"`; `CSS_FRAMEWORK_CHANNEL.classes = "css-class"`.
  `config.styling.framework: "classes"` selects it; only providers listing `"css-class"` in
  `styleChannels` honor it (initially just `none`).
- `provider-none.styleChannels` becomes `["tailwind-classname", "style", "css-class"]` with a
  `registryForChannel("css-class")` registry (`components-classes.tsx`): the same six
  primitives + helpers, structural defaults expressed as generated classes (`vl-button`,
  `vl-card`, …) instead of inline objects. Component-level interactive states (button hover,
  input focus ring) live in those component classes, derived from theme colors — closing the
  state gap for the common case without any new authoring surface.

## The generated inventory (`themeToClassesCss(theme)`)

One generator, consumed twice: injected into rendered documents by the renderer (after
`themeToCss`'s variable block — classes reference `var(--…)`, so dark mode flips for free),
and written to `velloo.css` by `emit_theme`. Derived strictly from tokens that exist in the
theme — no invented scale:

- **Typography** — `.h1`–`.h6` (from `typography.fontSize`/`fontWeight`/`lineHeight` keys),
  `.text-<size>` per `fontSize` key, `.font-<role>` per `fontFamily` role, weight/tracking
  classes per declared key.
- **Color** — `.bg-<slot>`, `.text-<slot>`, `.border-<slot>` for each semantic slot (and
  `-foreground` pairs); `palette` entries pass through the same way (their keys are already
  constrained to CSS-safe idents).
- **Spacing** — `.stack-<key>` (vertical flex + gap), `.p-<key>` / `.px-<key>` / `.py-<key>`,
  `.gap-<key>` per `spacing` key.
- **Radius / shadows** — `.rounded-<key>`, `.shadow-<key>` per declared key.
- **Container** — `.container` honoring `ContainerSchema` (center/padding/maxWidth).
- **Component classes** — `.vl-button`, `.vl-card`, `.vl-input`, … used by the
  `registryForChannel("css-class")` registry, including their `:hover`/`:focus-visible`
  states.

All emitted values are escaped/validated with the same discipline as `themeToCss`
(the theme-emit injection hardening applies to this generator from day one).

## Surfaces touched at implementation time

- `@velloo/provider` — channel kind, `CssFramework` value, channel constant.
- `@velloo/provider-none` — `components-classes.tsx`, `registryForChannel`, manifest notes.
- `@velloo/renderer` — `themeToClassesCss` + document injection when the screen's channel is
  `css-class`.
- `@velloo/codegen` — `emit_theme` writes `velloo.css`; `emit_code` lowers to plain HTML with
  `class` attributes (reusing the none/none inline lowering path, swapping the style channel).
- `@velloo/server` — `styleChannelOf` already resolves per-screen; inspector gets a
  class-picker pane listing the inventory (grouped by token family) with the inline-style
  editor as secondary; MCP instructions branch on the channel (adapter-supplied intro).
- `@velloo/canvas` — the class-picker style-editor pane.

## Non-goals (v1)

- Arbitrary/user-defined utility classes or responsive variant prefixes (`sm:` etc.).
  Media-query needs go through `theme/custom.css`.
- Renaming or customizing generated class names.
- Offering the channel for shadcn (intrinsically Tailwind) or MUI/emotion-based providers
  (intrinsically `sx`).
