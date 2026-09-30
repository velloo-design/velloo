---
name: velloo-setup
description: >-
  Calibrate a Velloo design folder to an existing codebase before designing —
  import the app's real theme and fonts, match its custom components, and
  verify the canvas against the running app. Use once per repo before the first
  design task, and again when the app's design language changes. Triggers:
  "set up velloo for this repo", "make the preview match my app", "why doesn't
  the canvas look like my app", or before recreating an app's page from an
  init handoff prompt.
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
router or wrap the whole screen. Snippets are for step 3 below.

## 1. Theme, fonts and the compare loop

The MCP instructions and `velloo://guide/porting` own this part: import the
app's stylesheet with `import_theme` (dry run, then `apply: true`), set its real
fonts with `set_theme { fonts }` — read how the app loads them; a wrong typeface
makes a correct layout read as wrong — then recreate one representative screen
and iterate `compare_to_url` against the running app, reading `unverified`
before trusting any number. Two additions that live only here:

- Run `score_theme_contrast` after the import. An app that only ever ships
  light mode often imports into a dark palette that fails.
- For a dashboard or feed whose content shifts between loads, pass
  `cacheUrl: true` so you diff against one frozen capture.

## 2. Establish component fidelity before adapting anything

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

## 3. Close only the important remaining gaps

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

## 4. Leave a record

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
