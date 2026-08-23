---
name: velloo-logo
description: >-
  Design a logo, wordmark, and full favicon/app-icon set in Velloo — explore
  marks across directions, converge on one idea, make the geometry exact with a
  live adjuster, compose the lockup, and export every icon size from one source
  SVG. Use when the user wants a logo, a mark, a wordmark, an app icon, or a
  favicon. Triggers: "design a logo", "make a mark/symbol", "create a wordmark",
  "we need a favicon", "app icon", "icon for the product".
---

# Logos & marks in Velloo

A logo is **geometry, not a render**. Explore widely, converge on **one** idea,
then make it exact. The non-negotiable test: the mark must read at **16px** (a
favicon) *and* at hero size, in **light and dark**. If it dies at 16px, it's
decoration, not a mark.

## 1. Diverge — explore mark directions

Generate candidates across genuinely different directions, a few each:

- **Monogram / letterform** (the initial, stylized).
- **Abstract symbol** (a metaphor for what the product does).
- **Geometric / 3D** (a form with depth — extract a clear silhouette from it).
- **Wordmark-only** (the name *is* the logo).

Two ways to make candidates, and you'll mix them:

- **Author SVG directly.** Clean, adjustable, diff-able, scales perfectly —
  always the path for the *final* mark.
- **Image generation for inspiration** *(optional; needs image-gen access or an
  API key)*. Use a vector-flat model for logos, a typographic model for
  wordmarks, an illustrative model for 3D/expressive forms — then **vectorize**
  the raster you like into a clean SVG you can refine. Treat gen output as a
  sketch, not a deliverable.

Lay the candidates on an **exploration board** as a numbered grid so the user can
pin favorites (`import_assets` pulls generated rasters straight in by path — no
base64). Keep the rounds; they're the decision log.

## 2. Converge — name the idea in one line

Before you refine anything, state the chosen idea in a single sentence —
"*two forms interlinked = X meets Y*", "*a path that's also a checkmark*". If you
can't say what it *means* in one line, it isn't a logo yet; it's a shape.

## 3. Make it exact — the adjuster loop

Logo geometry is a back-and-forth over a handful of numbers (offset, stroke
weight, corner radius, the crossing/overlap, optical centering). **Do not eyeball
this across dozens of screenshots** — that loop is slow and never converges.

Instead, stand up a **throwaway live adjuster**: a tiny standalone HTML page with
a slider per numeric value and **toggleable guide lines** (baseline, x-height,
centerline), rendering the SVG live with copy-paste output. The moment the user
has sliders and a guide line, the back-and-forth collapses to a single pass.
Bake the final numbers back into the master SVG.

## 4. The wordmark

- **Lowercase vs uppercase** is a real decision, not a default: lowercase reads
  modern/approachable, uppercase reads authoritative/established. Show both and
  choose deliberately — note the implication.
- Pick **one** family for the wordmark. Tune **tracking** until the spacing is
  optically even (tight negative tracking is normal on geometric sans). Use the
  adjuster's guide lines to lock baseline and x-height.
- Give it **one** ownable detail — a colored letter, a dot, a ligature, a cut.
  One. A wordmark with three gimmicks has none.

## 5. The lockup

Compose mark + wordmark with a gap defined **as a ratio of the wordmark size**,
so the lockup scales as one unit. Produce the standard variants a brand system
needs: **horizontal, stacked, mark-only, monochrome, inverse**, plus a
**clear-space** spec. Bundle the font locally if the wordmark ships in a UI (so
it renders offline, not just where the font happens to be installed).

## 6. Favicon & app-icon set — one source, every size

From the master SVG, export the whole set and wire it up:

- `favicon.svg`, `favicon.ico` (16/32/48 multi-res), `apple-touch-icon` (180),
  PWA icons (192/512), and an OG/social image.
- Add the `<link>` tags + the web manifest; set a `theme-color`.
- **Re-test the 16px crop.** If the mark is illegible small, *simplify it* (fewer
  strokes, more contrast) rather than shrinking detail nobody can see.

## Verify

`screenshot` the mark at **16, 24, 48, and hero**, in **light and dark**. It must
survive every size and both modes. The favicon is the honest test — pass that and
the rest is easy.
