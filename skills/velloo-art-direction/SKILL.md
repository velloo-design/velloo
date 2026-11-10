---
name: velloo-art-direction
description: >-
  Explore how a design could look before building it, with Velloo's art direction:
  write a brief from the app (or with the user, for something new), propose
  three directions, let the user narrow them while image models draw a mood
  board per direction and then full-page mocks, and build the mock they choose
  on the canvas from the app's own components. Use when the user wants a
  redesign, a new look, a fresh direction, or to see options before anything is
  built. Triggers: "redesign this page", "give me some directions", "show me
  options", "new look for the site", "start an art direction", "mood board", or a
  message from the canvas's art direction stage.
---

# The art direction

A redesign built from words alone stays close to what was there: the agent
moves the same blocks around. Pictures first breaks that. The user picks a
direction by looking at mood boards and full-page mocks, and you build the one
they choose. The full flow, operation by operation, is the guide
`velloo://guide/art-direction`; read it first. This skill is the judgement around
it.

## Who does what

- **You** write the brief and the directions, answer the user's asks, and
  build the chosen mock.
- **The user** narrows on the canvas (`?view=art-direction`): drops and edits
  directions, picks mood boards, picks the image model, draws and redraws the
  images, and chooses the mock. Give them the canvas link and let them drive;
  don't draw images they didn't ask for. Every image costs their credits.
- **`get_art_direction`** tells you where things stand and ends with `next`. Read it
  at the start of every turn that touches the art direction: the user may have
  changed everything since your last call.

## Writing a brief that holds

The brief is what keeps the mocks about *this* product. For an app that
exists, `content` is the page's real copy in order, taken from the code: every
heading, button label, figure and footer line. The image model reproduces what
it is given, so keep every one of those word for word; the whole copy fits in
2,800 characters, so shorten long paragraphs and cut repeated list items
rather than drop a section. Mark sections as `[HERO]`, pictures as
`[Image: what it shows]` and notes as `[like this]`: the canvas sets them out.
The user may have picked the page on the canvas: `get_art_direction` names it. For something new, ask a few
questions at a time (what it is, who it's for, what the first page must say,
what to avoid) and write the copy with the user before any direction.

## Directions worth choosing between

- **Three, and different.** Vary the axis that matters: era, material,
  density, colour temperature, type family. Make one a stretch. Three shades of
  the same tasteful minimalism is one direction.
- **Away from what the app has.** Read its current theme first; a direction
  that restates it wastes a mood board.
- **Drawable.** Hex values for the palette, the kind of typeface, the textures,
  the imagery, two or three motifs ("trail badges and ticket stubs"). An image
  model draws nouns, not "modern and clean".
- **A layout too.** One sentence on the hero and one on how the sections
  carry the content, in that look.

## Several art directions

A design keeps every art direction the user starts, so they can go back to
one and take it further. Every art direction call takes an `id`; the message
from the canvas names it, and without one the tools use the one changed last
(`get_art_direction` lists the `others`).

## Building the chosen mocks

The user may choose several mocks: build each as its own screen, on the board
the art direction names (`buildBoard`), and follow what they added
(`buildNotes`).

The mock is the target for layout, type, colour and rhythm. It is not the
source of truth for content or legibility:

- Set the theme (palette, fonts, radius) to the mock before composing, and
  write the direction's rules with `set_design_language`.
- Compose from the app's own components and the design's rules; a mock's
  button is the app's `Button` in the mock's colours, not a new drawing.
- Use the brief's copy. Anything the mock invented (numbers, names, trails,
  testimonials) is sample data: list it for the user.
- Draw the mock's photographs and illustrations with `generate_asset` only
  when `generateImages` is true: the user chose that when they handed you the
  mock, because every image costs credits. False means simple art of your own
  or clear placeholders; null means ask.
- Mocks ignore contrast and text size. Keep every text pair at WCAG AA and no
  text below the design's minimum, even where the mock is paler or smaller.
- Screenshot beside the mock and fix the three biggest differences, up to
  three rounds, before you call it done.

Report: the direction, what you set in the theme, what differs from the mock
and why, the sample data still on the page, and anything you couldn't check.
