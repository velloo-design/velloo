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

For shadcn folders, the canvas can import client-safe components directly from
the app's configured `components/ui` directory. That is a bounded capability,
not a promise that arbitrary application React can run inside a design iframe:
portal/state-heavy families use named canvas-safe adaptations, and a missing or
unbuildable file falls back independently. Other providers follow their own
adapter contract. The fidelity is observable through `component_status`; never
infer it from `installedInApp` or from a component merely appearing on screen.

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
resolve real families, set them with `set_theme { fonts }` — read the app's font loading
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
  captured a login page, so the similarity number is meaningless.
- **For a login wall, use a capture session.** `start_capture_session { url }`
  opens a real browser the *user* drives. It returns immediately — it does not
  wait — so say plainly what you need ("log in, then hit **Capture page** in the
  velloo toolbar on each page, then **Done**") and poll `list_captures` until
  their captures land. Then verify with `compare_to_url { captureId }` instead
  of `url`: the capture is already past the login and frozen, so it can't bounce
  to a login page or drift between runs. `storageStatePath` / `cookies` /
  `localStorage` stay available for when you already hold a session.
- If you cannot get a real capture, **leave it unverified and say so.** Tuning a
  design toward a page you never saw is worse than admitting the gap.
- For a dashboard or feed whose content shifts between loads, pass
  `cacheUrl: true` so you diff against one frozen capture instead of drifting
  content.

0.85+ similarity is a faithful structural port. Don't chase 1.0 — fonts and
live data legitimately differ.

## 3. Establish component fidelity before adapting anything

Only after theme parity, call `component_status { screen: "<id>" }` for each
screen you're about to design or verify (or `{ ids: [...] }` before a screen
exists). Check `mounted` first: the mount is all-or-nothing, so a single
`unavailable` component keeps the whole screen — and every screenshot and
`compare_to_url` of it — on Velloo's bundled components, whatever the other
statuses say. Fix or replace the blocking component before trusting any
`exact`. Treat the statuses as part of the design brief:

- **`exact`** — Velloo compile-checked and selected the app's source file for
  the whole-screen canvas mount. Custom CVA variants and ordinary explicit
  props are also reflected into discovery when their syntax is recognizable.
- **`adapted`** — the real family depends on portals, runtime state, browser
  layout, or another interaction that conflicts with a static selectable
  canvas. Velloo deliberately renders a canvas-safe counterpart. Preserve the
  component identity and props, but do not claim pixel-identical behavior.
- **`fallback`** — the app file is absent or failed the browser preflight, so a
  bundled provider component or Velloo helper is rendering. Read the returned
  note/errors before deciding whether the visual difference matters.
- **`unavailable`** — there is no usable canvas source, so a screen using it
  does not mount at all (`mounted: false`); read its errors — a resolution
  failure usually means the recorded app root is wrong
  (`velloo design set-app-root`).

Host-source edits invalidate the canvas bundle automatically. After changing a
component, wait for the frame to reload and call `component_status` again; do
not restart the daemon merely to pick up a normal source edit.

## 4. Close only the important remaining gaps

If an on-screen component is not `exact` and the difference is load-bearing,
read its source and choose the smallest honest adaptation:

- **A snippet** (`add_snippet`) that composes library primitives to match the
  component's appearance. It stays editable on the canvas and is the preferred
  answer for a bespoke compound component that is outside the shadcn library.
  Library compound components whose files are `exact` already preserve their
  children in the whole-screen mount and do not need a snippet. `render_snippet`
  immediately after defining one.
- **`$emitAs { name, importPath }`** on the node when the preview can be an
  approximation but the generated code must import the real component. Design
  with primitives, emit `<DataTable />`. Use this for anything whose appearance
  you cannot reasonably rebuild but whose identity in the code matters.
- **A live extension** (`add_extension` with `render: "live"`) only for the
  genuinely dynamic minority — charts above all. It bundles the real host file
  and client-mounts it, so it is the one path that renders the user's actual
  code. Know its limits before reaching for it: children are stripped, the
  mount is visual-only, and it breaks whenever the host file doesn't compile.
  Never the default for library components, and never use it to work around a
  compound component with children.

Do not replace an `adapted` overlay merely because its status is not `exact`;
the adaptation is what keeps dialogs, menus, popovers, and similar components
visible and selectable on a static canvas. Adapt only when the visual contract
the user cares about is materially different.

## 5. Leave a record

Write what you found as a note on the main board (`add_note`) so the next
session — and the user — knows where things stand. Three headings, honest:

- **Exact** — theme imported from `<path>`, fonts, and the components reported
  `exact` by `component_status`.
- **Adapted / fallback** — the status, reason, and any snippet / `$emitAs` / live
  decision made to close a load-bearing difference.
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
