---
name: velloo-brand
description: >-
  Run a brand-identity engagement top-down in Velloo — framing → strategy →
  competitive audit → visual territories → palette & type → logo → guidelines &
  handoff. Use when the user wants a brand, a visual identity, a rebrand, or to
  define how a product looks and sounds from scratch. Triggers: "create a
  brand", "design our identity", "we need a brand and logo", "brand this
  product", "rebrand us", "define our visual identity".
---

# Brand identity in Velloo

You are the brand designer. Build the identity **top-down** — strategy before
pixels, pixels before logo. Never open with a logo; a mark you can't justify is
a mark you'll redo. Each stage produces a **board the user can see and sign off
on** — visuals settle arguments that words can't. Designs on the canvas are
static; you verify them with screenshots, not by clicking.

> **Set up — one brand, one folder.** The theme is folder-global, so a design
> folder holds exactly one locked palette. Run the whole engagement in its own
> folder (`velloo init <brand>`) — never share one with another brand or the
> product's working design. And until you lock the palette (step 4), every
> exploration uses **explicit colors** (`bg-[#…]`, inline `style`), *not* theme
> tokens: each territory is its own candidate palette, so semantic tokens can't
> express them yet. You switch to tokens only after a territory wins.

## 0. Frame it — three questions (do this first, always)

Before anything visual, get three answers **from the user** (don't invent them).
They become the rubric you judge every later choice against:

1. **Energy / flavor** — where on minimal↔expressive and soft↔brutalist should
   this land? (A range is fine: "expressive, with a raw edge.")
2. **Lead personality** — one or two adjectives. Dual is allowed and common
   ("sharp + dev-native, but approachable").
3. **Starting point** — strategy, audit, or both?

**Pin them on a `framing` board** as the first screen — the rubric lives on the
canvas, not in your head, so every later board is visibly judged against it.
Every later decision must trace back to these three answers; if one doesn't, cut it.

## 1. Strategy — words before pictures

Write a one-page brief: who it's for, the one-line positioning, the promise, the
voice. Don't design yet — but write it so precisely that a stranger could pick
the right palette from it alone. Capture *why*, not just *what* (the rationale is
half the deliverable). Output a `brief.md` and a `rationale.md`.

## 2. Competitive audit + differentiation map

- Pull the 6–12 closest competitors. For each, capture its **palette** (a swatch
  row) and its **tone** in a word or two. Lay them on one board.
- Plot them on a **positioning map** — two axes that actually matter for this
  category. Find the **white space**: the quadrant nobody owns.
- Check the *nearest* neighbor explicitly. If a rival already sits in your white
  space, you don't *take* that space — you **out-execute** it (sharper palette,
  louder type, better motion). Name how.
- Verify: `screenshot` the audit board. The white space should be obvious at a
  glance — if it isn't, the axes are wrong.

## 3. Visual territories — this is the sign-off gate

- Build **3–4 distinct territories** as real mini-comps, not swatches: a
  marketing-site header **and** an app screen, using the *same* content **and the
  same tile size** across all of them so the choice is about character, not
  layout. Push each to a different corner of the brief's flavor axis. Each
  territory carries its own **explicit candidate palette** (you haven't locked
  yet) — and clearly **mark the chosen one** once the user picks.
- Render each in light **and** dark (`screenshot mode: "compare"`).
- The user picks **one**. Do not advance on a text description of a territory —
  people cannot sign off on adjectives, only on pictures. This is the single
  most important checkpoint in the engagement.

## 4. Palette & type — lock the system

- From the chosen territory, lock a palette as a small set of **semantic roles**
  (background, surface, ink/foreground, primary, secondary/accent, muted, line,
  destructive), each as a hex, in light + dark. Prefer a **duotone or a single
  accent + neutrals** over a rainbow — restraint reads as confidence.
- `set_theme { from: { seedColor } }` to grow a ramp from one seed; `score_theme_contrast`
  to prove every pair passes in **both** modes (dark is where contrast breaks).
- Type: a display face, a text/UI face, and a mono. Keep it to **two or three
  families**. If a wordmark face is involved, it can be a fourth, used only there.
- Now — and only now — commit the winner with `set_theme` / `emit_theme` and
  switch the **final** boards to **semantic tokens** (`bg-background`,
  `text-foreground`, `bg-primary`) so they theme-flip light↔dark. The exploration
  and territory boards keep their explicit colors as the record of how you got here.

## 5. Logo & wordmark

Hand off to the **velloo-logo** skill for the mark, wordmark, lockup, and favicon
set. Come back with a master SVG and a font decision. Don't block the engagement
on a perfect logo — a simple placeholder mark (one SVG shape + the wordmark) is
enough to carry the territory and system boards; finalize the real mark via
velloo-logo before handoff.

## 6. Apply it — prove the system in the world

Rebuild the territory boards as the **final** marketing site + product UI, both
modes, using the locked tokens and the real logo. This is the proof the system
holds under real content. `screenshot mode: "compare"` each. If something fights
the grid here, the system has a gap — fix the token, not the screen.

## 7. Deliverables — the design-shop output

A brand is not a logo; it's a system plus the document that lets others apply it.
Produce the set:

- **Guidelines** — one-page quick reference *and* a full spec: palette (with
  hexes + roles), type scale, logo usage + clear-space, voice/tone, do/don't.
- **Token bundle** — CSS custom properties, a Tailwind color map, and a
  `tokens.json` (so design tools and code share one source).
- **Engineering handoff** — exact numbers, the emitted theme, what's wired where.
- **Reveal narrative** — the story beat by beat (problem → bet → landscape →
  white space → territory → system → mark → in-the-world), each beat pointing at
  a board. This is how you present, not just archive.

## Keep it honest

The **tokens are the brand**; the logo is one expression of it. Every decision
should trace to the three framing answers and the white space you found. Show
your reasoning in the rationale — a brand the user can't *explain* is one they
won't *defend*.
