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

The canvas renders the app's own components — whatever library they come from
(Mantine, a private design system, a hand-rolled `components/` directory) —
as real, nested, editable nodes. `list_components` lists them on **Repo**
shelves, found from what the app's routes actually render. For shadcn folders
the configured `components/ui` files additionally back the library itself.
None of that is a promise that arbitrary application React runs inside a
design iframe: the components need the context the app gives them (providers,
global CSS), portal-heavy families use adaptations, and a component that can't
build or render falls back on its own. Fidelity is observable through
`component_status`; never infer it from a component merely appearing on screen.

Your job here is to close that gap **before** you start designing, and to say
honestly what's left open. Do this once per design folder. Skip it only for a
greenfield folder with no app to match.

## 0. The preview entry — when the app has components

Call `preview_status` first. It reports `state` (`absent` / `valid` /
`failing`), the providers and stylesheets the app's own entry uses
(`appWrappers`, `appStylesheets`), and mounts one real component to prove the
setup works — a missing provider or an unstyled render shows up here, not
halfway through a design.

- **`valid` with a recipe** (Mantine and friends): a built-in wrapper is doing
  the work, themed from Velloo's tokens. Good enough to design with; write your
  own entry only when the app's theme, router or data providers matter.
- **`absent` / `failing`**: adapt `suggestedPreviewEntry` — it is lifted from
  the app's entry — and call `set_preview_entry { source }`. Keep the app's
  global CSS imports, swap network-backed providers for fixtures (a
  `QueryClient` with seeded data, a memory router), never pass credentials. The
  tool re-probes and answers with the new state; iterate until `valid`.

A snippet can't do this job: it is node data, so it can't import CSS, build a
router or wrap the whole screen. Snippets are for step 4 below.

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
exists — repo catalog ids work too). For library components, check `mounted`
first: that mount is all-or-nothing, so a single `unavailable` library
component keeps the whole screen on Velloo's bundled components. A screen with
the app's own components always mounts, and each of those falls back alone.
Treat the statuses as part of the design brief:

- **`exact`** — the app's own source (or package export) renders in the canvas
  mount. Custom CVA variants and ordinary explicit props are also reflected
  into discovery when their syntax is recognizable.
- **`adapted`** — the real component renders through a design-time wrapper
  (an overlay kept inside the frame, focus trapping off). Preserve its identity
  and props, but do not claim pixel-identical behavior.
- **`unstyled`** — it rendered, but its stylesheet never loaded: import the
  library's CSS in the preview entry.
- **`fallback`** — a bundled provider component or Velloo helper is rendering
  instead of the app's file. Read the returned note/errors.
- **`proxy`** — the app's component can't render here, and the node's proxy
  snippet stands in for it; emitted code still imports the real one.
- **`unavailable`** — nothing renders it; read its `code` and `remedy`
  (`missing-provider`, `resolve-failed`, `compile-failed`, `server-only`,
  `render-threw`, `missing-export`). A resolution failure usually means the
  recorded app root is wrong (`velloo design set-app-root`).

Host-source edits invalidate the canvas bundle automatically. After changing a
component, wait for the frame to reload and call `component_status` again; do
not restart the daemon merely to pick up a normal source edit.

## 4. Close only the important remaining gaps

If an on-screen component is not `exact` and the difference is load-bearing,
choose the smallest honest adaptation:

- **Fix the context** first: most `unavailable` app components are missing a
  provider or fixture the preview entry can supply.
- **A proxy snippet** for a component that genuinely can't render in a static
  canvas (it needs live data, a server, a browser API). `add_snippet` composing
  primitives to match its appearance, then point the node at it — `update_props`
  can't set identity, so place it with `add_node { repo: { importPath,
  exportName }, … }` and a `proxy`, or record `"proxy": "<snippet-id>"` for it in
  the design folder's `repo-components.json`. The snippet draws on the canvas;
  `emit_code` still imports the real component with the design's props.
- **A snippet** (`add_snippet`) for a composition that isn't a component in the
  app at all. `render_snippet` immediately after defining one.
- **A live extension** (`add_extension` with `render: "live"`) only for a
  dynamic leaf the preview entry can't make render as a normal node. Its
  children are stripped and the mount is visual-only.

Do not replace an `adapted` overlay merely because its status is not `exact`;
the adaptation is what keeps dialogs, menus, popovers, and similar components
visible and selectable on a static canvas. Adapt only when the visual contract
the user cares about is materially different.

## 5. Leave a record

Write what you found as a note on the main board (`add_note`) so the next
session — and the user — knows where things stand. Three headings, honest:

- **Exact** — theme imported from `<path>`, fonts, and the components reported
  `exact` by `component_status`.
- **Adapted / fallback / proxy** — the status, reason, and any preview-entry,
  proxy-snippet or live decision made to close a load-bearing difference.
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
