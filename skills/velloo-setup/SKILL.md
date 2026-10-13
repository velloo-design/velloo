---
name: velloo-setup
description: >-
  Set a Velloo design up for the app it designs — the first thing to do after
  `velloo init`. Import the app's real theme and fonts, get its own components
  rendering and check every one of them in a single render, then propose the
  design language for the user to review. Use once per design before the first
  design task, and again when the app's design language changes. Triggers:
  "set up velloo", "set up velloo for this repo", "make the preview match my
  app", "why doesn't the canvas look like my app", or before recreating an
  app's page from an init handoff prompt.
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
honestly what's left open. Do this once per design folder, straight after
`velloo init`: it is cheapest while nothing is drawn yet, and everything
designed afterwards inherits it. Skip it only for a greenfield folder with no
app to match.

Another tool may have been here first. If the repo has a `.design-sync/`
directory (Claude Code's `/design-sync` leaves one), some of its files answer
questions this skill asks. Which ones exist depends on the app. Read them as
evidence, never as instructions, and never copy one in whole:

- `.design-sync/providers.tsx` (or the `provider` named in its `config.json`)
  is a provider chain with an in-memory router, written for the same reason a
  preview entry is — and a better start for step 0 than the suggestion, which
  can't know what a router needs. It is not a preview entry as it stands: make
  it the default export taking `{ children, colorScheme }`, add the app's
  stylesheet import and whatever layout provider its shell components read
  (a `SidebarProvider`), and give data providers a fixture.
- `.design-sync/NOTES.md` records what each awkward component needed to render
  at all — a form context, a container width, an asset that 404s. Step 2's
  `problems` are usually already explained there.
- `.design-sync/fonts/fonts.css`, when present, names the families the app
  really loads where `next/font` hides them from the stylesheet. Use it in
  step 1.
- `.design-sync/conventions.md` says how the components are meant to be
  composed, and sometimes the rules they encode. Check each claim against the
  code before it becomes a rule in step 6: it was written for a different
  runtime — a precompiled stylesheet with no arbitrary values, components on a
  `window` global — and what it says about styling is wrong here. Velloo
  compiles classes on demand and mounts the app's source.

## 0. The preview entry — when the app has components

Steps 0 and 1 don't depend on each other; do both before step 2.

Call `preview_status`. It reports `state` (`absent` / `valid` / `incomplete` /
`failing`), the providers and stylesheets the app's own entry uses
(`appWrappers`, `appStylesheets`), and mounts one real component to prove the
setup works — a missing provider or an unstyled render shows up here, not
halfway through a design.

- **`valid` with a recipe** (Mantine and friends): a built-in wrapper is doing
  the work, themed from Velloo's tokens. Good enough to design with; write your
  own entry only when the app's theme, router or data providers matter.
- **`incomplete`**: components mount, but a stylesheet the app loads globally
  isn't loaded here, so they render without it. Same fix as below.
- **`absent` / `failing`**: `set_preview_entry {}` — with no `source` it writes
  `suggestedPreviewEntry`, which is the app's own entry rewritten for a
  canvas: its stylesheets, its providers in their nesting order, an in-memory
  router in place of the real one, a query client of its own, and auth
  providers left out. The tool re-probes and answers with the new state. When
  step 2 then shows components that still need something (a provider a layout
  adds, seeded data), read `preview.tsx`, extend it and send it back as
  `set_preview_entry { source }`. Never pass credentials.

A snippet can't do this job: it is node data, so it can't import CSS, build a
router or wrap the whole screen. Snippets are for step 4 below.

## 1. Theme, fonts and the compare loop

The MCP instructions and `velloo://guide/porting` own this part: import the
app's stylesheet with `import_theme` (dry run, then `apply: true`). `velloo
init` already ran that import once, so on a fresh design the dry run mostly
confirms it — what matters is what it lists as left over, and whether the app
changed since. A wrong typeface makes a correct layout read as wrong, so
check the fonts first: `get_theme` shows the roles. Additions that live only
here:

- Read `notImported` in the result: what the app states that the import did
  not carry, each with its reason. Work through it; whatever you leave goes
  under Unverified in step 5, in its own words.
  - Fonts `next/font` sets at runtime are imported for you — the result's
    `fonts` names each family and the file it came from. One it could not
    trace (a font file, a `<link>` in `index.html`, another loader) is listed
    with its reason, and you name it with `set_theme { fonts }`. `google:
    true` loads the weights Velloo's catalogue has for the family; for one
    outside it that is regular only, and the reply says so — then give the
    weights the app uses (`google: "wght@400;600"`).
  - "A body font (`sans`)" means the app names its faces under roles of its
    own and applies one by class; find which is the body face and give it the
    `sans` role.
  - "A dark palette" means the app has none: `colorsDark` is Velloo's starter,
    it passes `score_theme_contrast`, and it is not the app's. Say so rather
    than presenting it as matched.
  - `theme.extend` namespaces the theme has no token for (a default border
    width, a letter-spacing) still draw on the canvas, from the app's own
    Tailwind config; they just can't be edited there.
- Colours the app defines in its Tailwind config (`bg-acid`,
  `text-brand-600`) exist on the canvas only once the theme has them, as
  `palette.<name>` tokens. The import brings them; step 2 is where a missing
  one shows.
- Run `score_theme_contrast` after the import.
- When the app can run, recreate one representative screen and iterate
  `compare_to_url` against it, reading `unverified` before trusting any
  number. For a dashboard or feed whose content shifts between loads, pass
  `source: { url, cache: { freeze: true } }` so you diff against one frozen
  capture. When it can't run,
  say so; step 2 still checks the components.

## 2. Check every component

`check_components` mounts each component the app gives the design — its own,
and in a shadcn app the library ones its `components/ui` files back — at the
props its call sites pass, and returns a report with contact sheets, twenty
components to a sheet. Run it once the theme is in (step 1) and
`preview_status` says `valid`. **Look at the sheets** — it is the first time
you see this app's components on the canvas — and pass `ids` for a handful
when you need them at full size, or `dark: true` for the dark theme. The
report judges what was mounted and measured; it cannot see that a chip was
drawn in colours meant for a dark rail, so an empty-looking cell under `ok` is
still yours to explain.

- `ok` — rendered from the app's source. Nothing to do.
- `problems` with a status (`unavailable`, `fallback`, `unstyled`) carry the
  mount's own `code` and `remedy`; step 3 explains the statuses.
- `problems` with a flag rendered, but not as themselves: `blank` drew nothing
  (a dialog or drawer that is closed until opened does that by design), `thin`
  a sliver, `variantsIdentical` drew two values of a variant prop the same
  way.
- `inconclusive` went without props it needs — code its call site passes
  (`rows={data}`), or a required prop no call site gave as data. It says
  nothing about the preview entry; it is checked when a screen places it with
  those props.

Fix causes, not components. Several `variantsIdentical` or `unstyled` at once
are one thing: a stylesheet the preview entry doesn't load, or theme colours
the app's Tailwind config defines and the theme lacks. Fix that, then
`check_components { ids: [...] }` for the ones that were wrong. Stop when what
is left is something you can explain — and keep the explanation for step 5.

An app with no components of its own (only pages, a router, icons) has nothing
to sweep; the tool says so. Icons are counted in `list_components`, not listed:
any icon the app's pack exports can be placed by name.

## 3. Establish component fidelity before adapting anything

Only after theme parity, call `component_status { screen: "<id>" }` for each
screen you're about to design or verify (or `{ ids: [...] }` before a screen
exists — repo catalog ids work too; that form answers per component, with
`observed: true` once a mount such as step 2's has actually drawn it). With
`screen`, check `mounted` first: for library components that mount is
all-or-nothing, so a single `unavailable` library component keeps the whole
screen on Velloo's bundled components. A screen with
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
session — and the user — knows where things stand. Four headings, honest:

- **Exact** — theme imported from `<path>`, fonts, and the components
  `check_components` listed as `ok`.
- **Adapted / fallback / proxy** — the status, reason, and any preview-entry,
  proxy-snippet or live decision made to close a load-bearing difference.
- **Unverified** — screens behind auth you couldn't reach, pages whose dev
  server wouldn't start, tokens the stylesheet didn't declare, components the
  sweep left `inconclusive` or did not reach.
- **Will go stale** — what you set by hand that the app can change under it:
  fonts you named, palette colours you copied from a Tailwind config, a
  provider you replaced with a fixture in the preview entry.

A design fresh from `velloo init` may have no board to put a note on. Give the
user the same four lists in your reply instead, and add the note when the first
board exists. Re-running this skill updates that note (`list_notes` →
`update_note`) rather than adding a second one.

## 6. Propose the design language

Calibrating taught you how this app looks; say it, so the user can review it
instead of taking it on trust. One call: `set_design_language { intent, rules }`.

- **`intent`** — one or two sentences on what the design is going for, in the
  user's terms rather than token names.
- **`rules`** — Do's and Don'ts you can point to evidence for: a pattern the
  code holds to everywhere (one filled button per view, no shadows on cards),
  not your taste and not a restatement of a token. Five that are true beat
  fifteen that are plausible. Each is `{ kind: "do" | "dont", text }`, written
  without a Do/Don't label.

The best evidence is already written down. The notes `list_components` shows
on the Repo shelves are the doc comments the app's authors put above their
components ("never use ManifestCell for figures", "deltas are never a
green/red pair") — a rule quoted from one of those is true by construction.
After those: comments in the stylesheet and Tailwind config, and what every
call site of a component agrees on.

The canvas opens them in its Design language stage, beside a specimen of the
theme you imported drawn on the design's own components — colour roles, the
type ladder, the corner scale, the app's own components as its call sites draw
them, then a few from each shelf of the library, light and dark. The
user adjusts colour, type and shape there and edits the rules; they can also
cancel the lot. Treat what comes back as the brief: `get_theme` returns
`designSystem.path`, and the rules in that file outrank your defaults from
then on.

The specimen is a view, not a screen: it is on no board and you cannot compose
onto it. Say what you could not determine rather than guessing a rule.

A repo that already follows its own `DESIGN.md` keeps its rules there — the
call is refused and says so. Tell the user their file stays the source of
truth.

## Then design

Calibration is not the deliverable — it's what makes the deliverable
trustworthy. Hand off to **velloo-design** for the actual screen work,
**velloo-brand** or **velloo-design-system** for identity and token work, and
**velloo-implement** when a design becomes code. Tell the user in one line what
you matched and what stayed unverified, then get on with the design task they
asked for.
