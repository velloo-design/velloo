---
name: velloo-setup
description: >-
  Calibrate a Velloo design folder to an existing codebase before designing —
  import the app's real theme and fonts, match its custom components, and
  verify the canvas against the running app. Use once per repo before the first
  design task, and again when the app's design language changes. Triggers:
  "set up velloo for this repo", "make the preview match my app", "why doesn't
  the canvas look like my app", or the setup step of an init handoff prompt.
---

# Calibrating Velloo to an existing app

The canvas does not read the user's component files. It renders Velloo's own
component library, themed by the design folder's tokens. For a stock app that
looks close enough; for an app with a custom Button, a real typeface, and a
tighter spacing scale, an uncalibrated canvas produces designs the user will
reject on sight — and they'll blame the design, not the setup.

Your job here is to close that gap **before** you start designing, and to say
honestly what's left open. Do this once per design folder. Skip it only for a
greenfield folder with no app to match.

## 1. Theme first — it buys the most

`import_theme { cssPath, apply: true }` against the app's stylesheet. This is
not just colors: it ingests `--radius`, `--font-*` roles, the non-semantic
palette (`--primary-600`, `--ink`), and — when it finds a `tailwind.config`
nearby — that config's `theme.extend` spacing, shadows, fonts, keyframes, and
`container` settings. Run it dry first (the default) and read the reported
changes; `apply: true` when they look like the app.

Init records the stylesheet it found in the folder config, so check there
before hunting. If there's no stylesheet (a `none`-CSS folder, an MUI app),
`import_theme` still takes raw `css` text, and an MUI app's `createTheme` call
is the equivalent source.

**Fonts are the highest-leverage single token.** A design in the wrong typeface
reads as wrong no matter how correct the layout is. If `import_theme` didn't
resolve real families, set them with `set_fonts` — read the app's font loading
(next/font, a `@font-face`, a Google Fonts link) to get the actual names.

Then `score_theme_contrast` to confirm the imported palette holds up in both
modes; an app that only ever ships light mode often imports into a dark palette
that fails.

## 2. Verify against the real thing, early

Do not wait until a design is finished to discover the baseline was wrong.
Recreate one representative screen — or use whatever init scaffolded — and run
`compare_to_url` against the running app.

- Get the app running first. Start its dev server yourself if the package
  scripts make it obvious; otherwise ask the user for the command, a running
  URL, or a deployed preview. Ask once, plainly, rather than guessing ports.
- **Read `unverified` on every result.** `redirected` / `authWall` means you
  captured a login page, so the similarity number is meaningless — pass
  `storageStatePath` (a Playwright storage-state JSON is the robust route) or
  `cookies` / `localStorage`. Ask the user how to reach an authenticated state,
  or ask for a route that needs no sign-in.
- If you cannot get a real capture, **leave it unverified and say so.** Tuning a
  design toward a page you never saw is worse than admitting the gap.
- For a dashboard or feed whose content shifts between loads, pass
  `cacheUrl: true` so you diff against one frozen capture instead of drifting
  content.

0.85+ similarity is a faithful structural port. Don't chase 1.0 — fonts and
live data legitimately differ.

## 3. Match the components that actually matter

Only after theme parity, and only for components that appear in the screens
you're about to design. Read the app's real component source, then pick the
cheapest mechanism that makes the preview honest:

- **A snippet** (`add_snippet`) that composes library primitives to match the
  custom component's appearance. This is the default answer. It stays editable
  on the canvas, costs nothing at render time, and is the only option that
  handles a compound component with children and slots. `render_snippet` right
  after defining it.
- **`$emitAs { name, importPath }`** on the node when the preview can be an
  approximation but the generated code must import the real component. Design
  with primitives, emit `<DataTable />`. Use this for anything whose appearance
  you cannot reasonably rebuild but whose identity in the code matters.
- **A live extension** (`add_extension` with `render: "live"`) only for the
  genuinely dynamic minority — charts above all. It bundles the real host file
  and client-mounts it, so it is the one path that renders the user's actual
  code. Know its limits before reaching for it: children are stripped, the
  mount is visual-only, and it breaks whenever the host file doesn't compile.
  Never the default for library components.

Don't adopt the whole component directory. Adopt what's on screen, when its
custom appearance is load-bearing, and stop.

## 4. Leave a record

Write what you found as a note on the main board (`add_note`) so the next
session — and the user — knows where things stand. Three headings, honest:

- **Matched** — theme imported from `<path>`, fonts, the components adopted and
  how (snippet / `$emitAs` / live).
- **Approximated** — where the canvas is close but not the app's real code.
- **Unverified** — screens behind auth you couldn't reach, pages whose dev
  server wouldn't start, tokens the stylesheet didn't declare.

Re-running this skill updates that note (`list_notes` → `update_note`) rather
than adding a second one.

## Then design

Calibration is not the deliverable — it's what makes the deliverable
trustworthy. Hand off to **velloo-design** for the actual screen work,
**velloo-brand** or **velloo-design-system** for identity and token work, and
**velloo-implement** when a design becomes code. Tell the user in one line what
you matched and what stayed unverified, then get on with the design task they
asked for.
