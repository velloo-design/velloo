---
name: velloo-sketchbook
description: >-
  Explore how a design could look before building it, with Velloo's sketchbook:
  write a brief from the app (or with the user, for something new), propose
  three directions with their tokens, let the user pick them and draw
  inspiration and full-page mocks on the canvas, and build the screens they
  choose from the app's own components, each direction on its own Look. Use when the user wants a
  redesign, a new look, a fresh direction, or to see options before anything is
  built. Triggers: "redesign this page", "give me some directions", "show me
  options", "new look for the site", "start a sketchbook", "mood board", or a
  message from the canvas's sketchbook stage.
---

# The sketchbook

A redesign built from words alone stays close to what was there: the agent
moves the same blocks around. Pictures first breaks that. The user picks a
direction by looking at its tokens, inspiration images and full-page mocks,
and you build the screens they choose. The full flow, operation by operation, is the guide
`velloo://guide/sketchbook`; read it first. This skill is the judgement around
it.

## Who does what

- **You** write the brief and three directions, each with its token
  `proposal`, then stop; you answer the user's asks and build the screens.
- **The user** narrows on the canvas (`?view=sketchbook`): picks and edits
  directions, picks the inspiration to draw and the image model, draws and
  redraws the images, and chooses what each screen is designed from (a mock,
  an inspiration image, or the direction alone). Give them the canvas link
  and let them drive; don't draw images or move the stage on unasked. Every
  image costs their credits.
- **`get_sketchbook`** tells you where things stand and ends with `next`. Read it
  at the start of every turn that touches the sketchbook: the user may have
  changed everything since your last call.

## Writing a brief that holds

The brief is what keeps the mocks about *this* product. For an app that
exists, `content` is the page's real copy in order, taken from the code: every
heading, button label, figure and footer line. The image model reproduces what
it is given, so keep every one of those word for word; the whole copy fits in
1,450 characters, so shorten long paragraphs and cut repeated list items
rather than drop a section. Mark sections as `[HERO]`, pictures as
`[Image: what it shows]` and notes as `[like this]`: the canvas sets them out.
The user may have picked the page on the canvas: `get_sketchbook` names it. For something new, ask a few
questions at a time (what it is, who it's for, what the first page must say,
what to avoid) and write the copy with the user before any direction.

## Directions worth choosing between

- **Three, and different.** Vary the axis that matters: era, material,
  density, colour temperature, type family. Make one a stretch. Three shades of
  the same tasteful minimalism is one direction.
- **Away from what the app has.** Read its current theme first; a direction
  that restates it wastes the user's pick.
- **Drawable.** Hex values for the palette, the kind of typeface, the textures,
  the imagery, two or three motifs ("trail badges and ticket stubs"). An image
  model draws nouns, not "modern and clean".
- **A layout too.** One sentence on the hero and one on how the sections
  carry the content, in that look.
- **Tokens that say the same.** The `proposal` is the direction as a theme:
  its palette light and dark, radius and a Google Fonts pairing, every text
  pair at AA (the write answers with `underAA`). The canvas shows it beside
  the words; a proposal that contradicts the description reads as two
  directions.
- **From the references.** When the user added `references` (screenshots of
  sites they like), open each `file` and read its `note` before proposing, and
  draw at least one direction from them: name its source in the description
  and list the reference ids in its `references`, so they go to the image model.

A remix (`update_sketchbook { remix: { from: [a, b], take } }`) joins two
directions' words around what it takes from each: read the joint description
back and tighten it when it contradicts itself.

## Several sketchbooks

A design keeps every sketchbook the user starts, so they can go back to
one and take it further. Every sketchbook call takes an `id`; the message
from the canvas names it, and without one the tools use the one changed last
(`get_sketchbook` lists the `others`).

## Kinds of image

Beside mood boards and mocks, the cloud may draw a palette in context, a type
poster, a UI kit sheet, an imagery study, an icon sheet, a mobile mock and a
close-up (`get_sketchbook`'s `kinds`), and a `custom` image the user describes
(`ask`). Draw one with `generate_sketchbook { kind, directions }` when the
user asks. Mobile mocks and close-ups are pages like mocks; the rest show
the system (colours, faces, components, imagery). All of them come with the
build.

## Building the screens

The user keeps the directions to design from (`toDesign`), and may leave
single images out of the set (`excluded`: ignore those) and asks for
`screenCount` screens from each: make them different takes on the direction
(another composition, hero and rhythm each), on its board (`buildBoards`),
which is pinned to the direction's Look, and follow what they added
(`buildNotes`). Each screen is designed from the whole direction: its words,
its Look's tokens, the brief, its inspiration and its mocks. A direction with
no images is designed from its words alone.

The mock is the target for layout, type, colour and rhythm. It is not the
source of truth for content or legibility:

- Where the mock's palette, fonts or radius differ from the board's Look, set
  them on that Look (`set_theme { theme }`) before composing, and write the
  direction's rules with `update_look`; never touch the default theme.
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
