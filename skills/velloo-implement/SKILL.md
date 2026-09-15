---
name: velloo-implement
description: >-
  Turn a Velloo design into production code — emit the theme, snippets, and
  screens as framework-native IR (shadcn/Tailwind, MUI sx, or no-framework
  inline styles), write real files in the app's conventions, then verify the
  implementation against the canvas. Use when the user wants to implement a
  Velloo design, generate code from the canvas, or sync an app with its
  design. Triggers: "implement the velloo design", "build the page from the
  design", "turn the design into code", "generate the code for this screen".
---

# Implementing a Velloo design

The Velloo canvas is the visual source of truth; **you write the production
code**. Emit gives you honest IR — library identifiers and native styling
verbatim, no imports, no formatter pass — and you translate it into real files
in the app's own conventions. Designs are static by construction, so state,
routing, handlers, and data are yours to add.

## Before you start

- The velloo MCP tools come from your MCP config (`velloo mcp`); the server's
  `initialize` instructions are the authoritative tool reference.
- Scope the work: `list_screens` / `list_boards` for what exists,
  `get_screen mode: "outline"` for a quick structure read, `list_components kind: "snippet"`
  for the reusable pieces, `get_theme` for the token model.
- Read the app first: the router (Next/Vite/Astro/Remix), where components
  live, the components import alias, how pages fetch data, and whether the
  components the design uses actually exist in the app yet.

## Emit order: theme → snippets → screens

1. **`emit_theme { outputDir }` — dry-run first.** It returns per-file diffs
   without writing; review them, then re-run with `apply: true`.
   - shadcn folder → Tailwind v4 `globals.css` (the `@theme` block, `.dark`
     overrides, base layer) plus `tailwind.config.ts` (`cssOnly` skips it).
     `cssPath` defaults to `app/globals.css` — pass `src/index.css` (Vite) or
     wherever the app's entry CSS actually lives.
   - MUI folder → a `createTheme(...)` module (default `theme.ts`, dark theme
     included when the design has one). Wire it into the app's ThemeProvider.
   This is the one direct artifact — no agent translation needed.
2. **`emit_snippet` per snippet** → a PascalCase component name, typed params,
   and a JSX body with `{param}` holes. Write each as a real component: params
   become props, `node` params become children/slots, and keep the emitted
   classes/`sx` verbatim — that's what makes the result match the design.
   Snippets emit a `className?: string` passthrough — keep it.
3. **`emit_code` per screen** → the page's layout skeleton. Wrap it in the
   framework's route/page shell, import the snippet components you just
   wrote, and add what Velloo doesn't own. `componentsAlias` defaults from
   the folder config (set at init); override per call if the app resolves
   imports differently.

## The IR is framework-native — keep it that way

- **shadcn** → library ids map 1:1 to the app's shadcn components; Tailwind
  classes transfer verbatim. The emit result lists every component used — if
  the app is missing one, install it with `npx shadcn@latest add <name>`
  rather than hand-rolling a lookalike.
- **MUI** → components import from `@mui/material`, styling stays in
  `sx={{…}}`, and tokens ride the emitted `createTheme` module.
- **No-framework** → plain HTML elements; Tailwind classes when the folder's
  CSS framework is tailwind, inline `style={{…}}` objects referencing the
  `var(--…)` theme variables when it's none.
- **Extensions** emit as real imports from their declared `importPath` — the
  design's `DataTable` / chart nodes come back as the app's own components
  with the captured props. Don't re-implement them.
- Icons are lucide-react imports (`<ArrowRight className="…" />`).

## Warnings are part of the contract

Every emit result carries a `warnings` array (per-snippet warnings ride on
`snippetsUsed[].warnings`). Non-empty means something couldn't be expressed
faithfully — e.g. a dynamic icon-name param baked to a single glyph. Resolve
each one in the real component (usually a `node` param or a prop switch);
never ship a warning blind.

## Verify against the design

1. Run the app's dev server.
2. `compare_to_url { screenId, url }` at the same viewport for each
   implemented page. 0.85+ similarity is a faithful structural port; the
   per-region node refs name what's off. Don't chase 1.0 — fonts, imagery,
   and live data legitimately differ.
3. An `unverified` result means STOP — don't iterate against a page you
   never actually captured. If it's a login wall, `start_capture_session
   { url }` opens a browser the *user* drives (it returns immediately; tell
   them to log in, hit **Capture page**, then **Done**, and poll
   `list_captures`), then verify with `compare_to_url { captureId }`. If it's
   the dev server, fix that first. `storageStatePath` / `cookies` remain the
   option when you already hold a session.
4. When implementation drifted from the design, fix the code. When the design
   itself should change, fix it in Velloo (through the MCP tools — never edit
   the design folder's JSON by hand), then re-emit and diff.

## App conventions win

Match the codebase: file naming, the server/client component split
(`"use client"` only where interactivity needs it), the app's data-fetching
layer, its test patterns. The IR provides structure and styling; everything
else should read like the user wrote it.
