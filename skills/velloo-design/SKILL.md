---
name: velloo-design
description: >-
  Design UI through Velloo, a local code-shaped design canvas whose components
  are the project's real shadcn library. Use when the user wants to design a
  screen, lay out a UI, or port an existing page onto the canvas. Triggers:
  "design a screen in velloo", "lay this out", "port this page into velloo".
  For turning a finished design into production code, use the velloo-implement
  skill instead.
---

# Designing with Velloo

Velloo is a local design canvas where **you, the agent, are the designer**. You
compose screens from the project's own component library through an MCP server,
verify them visually, then emit an intermediate representation (IR) you turn
into real code in the user's conventions. Designs are static — no handlers, no
routing, no data fetching live on the canvas; those are yours to write when you
implement.

## Connect

You start the velloo MCP server yourself — it's wired into your MCP config as
`velloo mcp`, so the tools are available once the config is loaded; there's
nothing to run first. If the velloo tools aren't available, tell the user to run
`velloo connect <design-folder>` and restart you. To see the canvas, run
`velloo run <design-folder>` — it prints and opens the canvas URL (defaults to
`:7300`, but picks a free port if that's taken, so don't assume 7300). When a
canvas is already running, the server's `initialize` instructions hand you its
live URL — use that. Those instructions are also the authoritative tool
reference — read them; this skill is the workflow on top.

## Design loop (composing screens)

1. **Discover before composing.** Call `list_components` (`mode: "summary"`
   first — the full schema is large; full mode carries a working `example` per
   component), `get_theme`, and `list_snippets`. Reuse existing snippets before
   defining new ones.
2. **Prefer semantic theme tokens** (`bg-background`, `bg-card`, `text-foreground`,
   `text-muted-foreground`, `border-border`, `bg-primary`, `bg-accent`) over raw
   palette colors (`bg-zinc-900`, `text-white`). Semantic tokens auto-flip in
   dark mode and survive theme changes; raw palette colors render identically in
   both. Use raw palette only for an *intentional* accent that should not flip —
   and mark that node `data-accent: "ok"` so `audit` exempts it.
3. **Build with `children` subtrees, not node-by-node.** `add_node` takes a full
   subtree in one call. For repeated structure (list rows, cards, nav items),
   define a **snippet** with typed params once (`add_snippet`), then
   `instantiate_snippet` per occurrence. `batch` runs many mutations atomically
   in one round-trip.
4. **Think in ids.** Pass `id:` at creation and address nodes as `"@id"` in
   later calls — number paths shift when siblings move.

### Snippet params — pick the right type

In the snippet **body** you write `{"$param":"name"}` refs (not literal `{name}` —
that renders as text). *Where* the ref goes depends on the type:

- `string` / `number` / `boolean` / `enum` → a **scalar**. Put the ref in a **prop
  value**, e.g. `{"$ref":"Heading","props":{"children":{"$param":"title"}}}`. A scalar
  ref dropped straight into a `children` array errors (it resolves to nothing).
  `emit_code` later turns these into `{param}` holes in the generated JSX.
- `node` → a slot the caller fills with a subtree. Put the ref **in a `children`
  array**. **Use this for anything that varies per instance, including an icon that
  changes by data** (status, priority).
- `icon` → ONE icon chosen at design time. It bakes into the emitted JSX as a
  literal `<Sparkles/>`. Do **not** use an `icon` param for a per-instance icon:
  a lucide name must be a literal JSX tag, so every instance would collapse to the
  same glyph (and `emit_snippet` will warn). Reach for a `node` param instead.

## Verify (this is Velloo's edge — use it)

- **`render_snippet` right after `add_snippet`.** `$param` wiring bugs are silent at
  definition time and only surface at instantiation. Preview before stamping.
- **`screenshot mode: "compare"`** renders light + dark side by side — the fastest
  check that the design adapts. `screenshot diff: true` compares against your last
  capture (zero change costs no image). Pass `scale: 0.5` for layout checks.
- **`audit`** flags color classes that won't theme-flip. It's a triage signal, not
  a gate: read the per-node `problems[]` and decide. `data-accent` nodes are exempt.
- **`score_theme_contrast`** scores light AND dark palettes — run it after any theme
  edit; dark is where contrast usually breaks.
- **`validate_classes`** is free — run it on arbitrary-value classes (`shadow-[…]`,
  `grid-cols-[…]`) before relying on them.

Icon names accept PascalCase (`ArrowRight`) or kebab-case (`arrow-right`); a name
that matches no lucide icon renders a `?` fallback and the mutation result carries
an advisory warning — fix those.

## Implement loop (design → code)

When the design is ready to become real code, switch to the **velloo-implement**
skill — it covers the emit order (theme → snippets → screens), the
framework-native IR, warnings handling, and verifying the implementation with
`compare_to_url`. The short version: emit is honest IR (identifiers + classes
verbatim, no imports, no formatter); you write the real files.

## Porting an existing app onto the canvas

Re-express, don't pixel-clone. `import_theme` with the app's `globals.css` first
so palette/radius match; read the page source alongside `list_components` and
rebuild it as one screen (strip handlers/state, inline representative copy, keep
Tailwind classes verbatim — most shadcn refs map 1:1); a presentational custom
component becomes a snippet, a complex app component (`DataTable`, charts) becomes
an extension via `add_extension`; verify with `compare_to_url`.

## Designing from a page you can't load

Behind a login, on staging, or somebody else's site — there's no source to read
and `compare_to_url` just captures the login screen. Use a **capture session**:
the user drives a real browser, you read what they capture.

1. `start_capture_session { url }`. It opens a browser window and **returns
   immediately with a `sessionId` — it does not wait for the session.** Don't
   block on it and don't call it again to check.
2. Tell the user exactly what to do: log in, then hit **Capture page** in the
   velloo toolbar on each page worth designing from, then **Done**. Poll
   `list_captures` until their captures appear.
3. `get_capture` each one. You get a structural `outline` of the page,
   `themeCss` — its real CSS custom properties, dark block included — `fonts`,
   and downloaded image `assets`. Run `import_theme` with that CSS *before*
   composing so the site's own tokens resolve; `upload_asset` the images you need.
4. Build with real components. **The extract is evidence, not a tree** — a
   scraped DOM is div soup with resolved pixel values, and transcribing it
   node-for-node produces exactly the absolutely-positioned clone this skill
   tells you not to build. Repeated blocks are marked in the outline: a run of
   identical siblings is ONE component instantiated N times, so make it a
   snippet rather than N copies.
5. Verify with `compare_to_url { captureId }`, not `url` — the capture is past
   the login and frozen, so it can't bounce to a login page or drift between
   calls.

The user can also make captures themselves ahead of time with `velloo capture
<url>`; `list_captures` shows anything already stored, so check there before
asking them to open a browser.

## What stays yours

State, routing, interactivity, data — Velloo is a visual-layer compiler and the
emit IR is honest about owning none of these. Write them by hand when you
implement. That clean line is the contract; don't expect the design to encode it.
