---
name: velloo-design-system
description: >-
  Turn a brand into a working design system in Velloo — token scales (color,
  type, spacing, radius), a themed component inventory, reusable snippets, and a
  living style guide emitted into the real app. Use when the user wants a design
  system, design tokens, a component library styled to their brand, a style
  guide, or to theme an app coherently. Triggers: "set up a design system",
  "define our tokens", "build/style our component library", "make a style
  guide", "theme the app", "do we need a design system?".
---

# Design systems in Velloo

A design system is **tokens + components + the rules that bind them**. Velloo
already speaks both — the theme *is* your tokens, the shadcn snapshot *is* your
components — so your job is to make them coherent, prove they hold, and **emit
them into the real app**. The canvas re-renders against the tokens live, so you
*see* the system instead of describing it.

## Do you even need one? (answer this honestly first)

- **One product, one brand:** the theme (tokens) + the component snapshot usually
  *is* the system. Don't build a 200-page portal for a single app — formalize the
  tokens, build a style-guide screen, ship. Over-building a system is a way to
  avoid shipping the product.
- **Multiple products/surfaces, a team, or a public component library:** yes,
  formalize it — shared tokens, documented patterns, versioning.

State which case you're in before you start; it sets the scope.

## 1. Tokens — the foundation

Define the **whole** scale, not just brand colors:

- **Color roles**, each in light + dark: background, surface(s), foreground/ink,
  primary, accent, muted, line/border, destructive. Use *semantic roles*, never
  raw palette values scattered through screens.
- **Radius** scale, **spacing** rhythm, **type** scale (sizes + weights + line
  heights), and a **mono**.

`derive_palette_from_color` grows ramps from a seed; `score_theme_contrast`
proves every foreground/background pair passes in **both** modes (dark breaks
first). `set_token` makes them live — the canvas reflows so you can judge the
system, not a spec sheet.

## 2. Component inventory — the system's audit

Build one board that shows **every component the product actually uses**, themed:
buttons (all variants + states), inputs, selects, cards, nav, tables, badges,
empty states, toasts, dialogs. One screen, sectioned by kind.

This board *is* the audit. Anything that looks wrong here is a token bug, not a
component bug. Run `audit` to flag color classes that won't theme-flip and fix
them to semantic tokens (mark intentional fixed accents `data-accent: "ok"`).

## 3. Patterns — snippets with typed params

Recurring structures (a list row, a stat card, a form field, a nav item) become
**snippets** with typed params (`add_snippet`), verified with `render_snippet`
*before* you stamp them — `$param` wiring bugs are silent until instantiation.
These are your real components-to-be; define each once, instantiate per use.

## 4. The living style guide

Compose a **style-guide screen** rendered entirely from the same tokens: palette
swatches with role names + hexes, the type scale in situ, the spacing/radius
scale, the component inventory, and voice/tone notes. Because it's built from the
tokens, it can't drift — change a token and the guide changes with it. That's the
whole point: **one source of truth, zero stale docs.**

## 5. Emit into the app

Velloo's emit is honest IR — it owns the visual layer, not your state/routing:

- `emit_theme { apply: true }` → the Tailwind `globals.css` (the entire color
  system) wired into the app's entry CSS. This is the keystone artifact.
- `emit_snippet` per pattern → a real component; map its `{param}` holes to your
  props/data.
- `emit_code` per screen → the layout skeleton (and a `/styleguide` route if you
  want the guide to live in the app).
- **Read the `warnings` array on every emit.** A non-empty `warnings` means
  something couldn't transfer faithfully — handle it, don't ship it blind.

## Keep it honest

The system **is the tokens**; components are downstream. A change should happen
**once** — at the token — and propagate everywhere. If you find yourself editing
the same color in five places, the system has a hole; close it at the source.
