---
version: alpha
name: velloo
description: "The Velloo canvas chrome — the interface a designer works inside, which must never compete with the design on the canvas. Tokens emitted from velloo/theme/default.json, the theme the chrome actually renders with."
omitted:
  - section: components
    reason: "Velloo styles nodes directly; it has no per-component token store."
colors:
  background: "oklch(0.99 0 0)"
  foreground: "oklch(0.18 0.01 264)"
  primary: "oklch(0.56 0.18 264)"
  primary-foreground: "oklch(0.99 0 0)"
  secondary: "oklch(0.96 0.005 264)"
  secondary-foreground: "oklch(0.22 0.01 264)"
  muted: "oklch(0.96 0.005 264)"
  muted-foreground: "oklch(0.5 0.01 264)"
  accent: "oklch(0.95 0.02 264)"
  accent-foreground: "oklch(0.22 0.01 264)"
  destructive: "oklch(0.58 0.22 27)"
  destructive-foreground: "oklch(0.99 0 0)"
  card: "oklch(1 0 0)"
  card-foreground: "oklch(0.18 0.01 264)"
  popover: "oklch(1 0 0)"
  popover-foreground: "oklch(0.18 0.01 264)"
  border: "oklch(0.95 0.004 264)"
  input: "oklch(0.93 0.005 264)"
  ring: "oklch(0.56 0.18 264)"
typography:
  h1:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Inter\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: 40px
    fontWeight: "700"
    lineHeight: 1.103
    letterSpacing: -0.025em
  h2:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Inter\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: 32px
    fontWeight: "700"
    lineHeight: 1.155
    letterSpacing: -0.025em
  h3:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Inter\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: 24px
    fontWeight: "600"
    lineHeight: 1.243
    letterSpacing: -0.02em
  h4:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Inter\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: 20px
    fontWeight: "600"
    lineHeight: 1.295
    letterSpacing: -0.02em
  h5:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Inter\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: 18px
    fontWeight: "600"
    lineHeight: 1.4
    letterSpacing: -0.015em
  h6:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Inter\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: 16px
    fontWeight: "600"
    lineHeight: 1.4
    letterSpacing: -0.01em
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Inter\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: 16px
    fontWeight: "400"
    lineHeight: 1.75
  lead:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Inter\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: 20px
    fontWeight: "400"
    lineHeight: 1.593
  small:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Inter\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: 14px
    fontWeight: "500"
    lineHeight: 0.997
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Inter\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: 14px
    fontWeight: "400"
    lineHeight: 1.505
rounded:
  sm: "4px"
  md: "0.625rem"
  lg: "8px"
  xl: "12px"
  full: "9999px"
spacing:
  "0": 0
  "1": 4
  "2": 8
  "3": 12
  "4": 16
  "6": 24
  "8": 32
  "12": 48
  "16": 64
---
## Overview

Velloo is a design canvas that lives in your repo. This describes the **chrome** — the header, panes, inspector, dialogs and HUD that surround the canvas — not the designs people make with it.

That distinction is the whole brief. Every screen here is a frame *inside* the product, and the user's own design is the subject of the page. The chrome is the matte around a picture: precise, quiet, obviously secondary. It should feel like a well-made developer tool — dense, fast, unfussy — and it should be nearly invisible the moment someone starts working. If a reviewer's eye goes to the chrome before the canvas, the chrome is wrong.

The voice is plain and technical. No exclamation, no marketing warmth, no reassurance. Labels say what a thing does.

## Colors

One chromatic color, and it is `primary` — an indigo at hue 264. It marks the active thing: selection, focus rings, the current board, a primary action. Nothing else in the chrome is allowed to be colorful, which is what makes selection readable against whatever palette the user's design happens to use.

Everything else is a near-neutral built on the same hue at very low chroma (0.005–0.02), so the greys stay related to the accent without reading as blue. `background` is a fraction off white rather than white, so a white artboard on the canvas separates from the surface behind it. `border` at `oklch(0.95 0.004 264)` is deliberately faint: structure should be legible without being drawn.

`destructive` is the only other chromatic slot and appears only on destructive confirmation.

**Both modes are first-class.** The canvas has a design mode that flips independently of the app theme, and the chrome is read against user designs in both. Every surface must come from a semantic slot so it flips; a literal color will be correct in one mode and wrong in the other.

## Typography

A system stack, no webfont. The chrome should paint on first frame and look native to the machine it is running on; a loading typeface in an IDE is a bug, not a brand.

The ladder derives from three controls (base size, body leading, block flow) rather than a per-element scale — `set_theme { typeset }` re-proportions everything at once. Chrome text is small and tight: most of it is labels, not prose. Reach down the ladder (`small`, `caption`) before reaching for a custom size, and let `muted-foreground` carry anything that is metadata rather than content.

## Layout

A 4px grid, exposed as the named steps in `spacing`. Panes are fixed-width and resizable; the canvas takes the rest.

Density is a feature. This is a tool someone keeps open all day beside an editor, so prefer one more row visible over one more pixel of breathing room. Padding inside chrome panels stays at the `3`/`4` steps; the generous end of the scale belongs to the user's designs, not to the frame around them.

## Elevation & Depth

Borders do the structural work, not shadows. A pane is separated by a hairline and a surface step, which keeps the chrome flat and lets a real shadow on the canvas read as the user's own design choice rather than ours.

Shadow is reserved for things that genuinely float above the interface — dialogs, popovers, menus, the drag preview. If something is not overlaying content, it does not get a shadow.

## Shapes

`rounded.md` (10px) is the default for panels, inputs and buttons. Smaller controls take `sm`; only avatars and status dots take `full`.

Corners are consistent rather than expressive. A mixed radius vocabulary in chrome reads as inconsistency, not personality.

## Components

The chrome is built from the canvas's own `src/components/ui/*` — real shadcn, with real portals and working overlays. Before writing a new pattern, look for the family that already is it: a labelled input is `Field`, a search box is `InputGroup`, a "nothing here" panel is `Empty`, joined buttons are `ButtonGroup`. Hand-rolling one of those is how five different empty states ended up in the codebase.

Design-mode frames render the user's chosen library, not this one. Do not reach into the canvas chrome's components when composing a design.

## Do's and Don'ts

- **Don't** let the chrome compete with the canvas. If a screen reads as a page in its own right, it is too loud for what it is.
- **Do** keep `primary` indigo as the only chromatic color in the chrome — selection, focus and the active item. A second accent makes selection ambiguous.
- **Don't** hard-code a color. Light and dark are both shipping states and a literal value is wrong in one of them.
- **Do** use `muted-foreground` for metadata, counts, paths, timestamps and hints, and reserve `foreground` for the thing the user is actually reading.
- **Don't** use shadow for hierarchy. Borders and surface steps separate chrome; shadow means "this floats above the page".
- **Do** stay dense — this is a tool, not a landing page. Prefer another visible row to more whitespace.
- **Don't** add decorative gradients, illustrations or imagery to the chrome.
- **Do** reach for an existing `components/ui` family before inventing a pattern.
- **Don't** write instructional prose into the UI. A tooltip or an empty state says what to do in one line; anything longer belongs in the docs.
