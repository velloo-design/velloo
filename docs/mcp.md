# MCP Surface

> Velloo's MCP tool surface for AI agents. Token-efficient by construction.

Designed for token efficiency: every tool is scoped, typed, and operates on small JSON. Compared to Penpot's `execute_code` (raw JS over the entire Plugin API) or Paper's `write_html` (HTML literals), each operation here is a single structural mutation with predictable cost.

A typical screen is 30–80 nodes, ~2–4 KB of JSON. The agent can `get_screen`, plan multiple ops, and apply them in a tight loop with low token spend per turn.

## Tool surface

### Discovery

| Tool | Args | Returns |
|---|---|---|
| `list_screens` | `include_tree?: boolean` | `[{ id, name, tree? }]`. Pass `include_tree: true` for a single-round-trip overview of every screen |
| `get_screen` | `screenId, mode?: "full" \| "outline"` | full screen JSON, or a stripped `{ref/snippet, $id, classSnippet (≤40 chars), children}` tree when `mode: "outline"` for scanning long screens |
| `list_boards` | `include_frames?: boolean` | `[{ id, name, frameCount, frames?, groups? }]` — pass `include_frames: true` to embed each board's full frame list in one round-trip |
| `get_board` | `boardId` | `{ id, name, frames: [...], groups: [...] }` — frame placement on the named board |
| `list_components` | `filter?, mode?: "summary" \| "full"` | `[{ id, props, category, summary }]` — summary mode returns just `{ id, props (names only), category, source }` to avoid blowing the token cap on first call |
| `list_snippets` | — | `[{ id, name, params }]` |
| `get_snippet` | `snippetId` | full snippet JSON (`{ id, name, params, tree }`) |
| `get_theme` | — | full token tree |
| `list_annotations` | `screenId` | Designer-authored markdown annotations on a screen. Each carries a `target: { locator }` and a `resolved` path (null when the targeted node has been removed — treat as low-priority). Read-only: agents can act on annotations but not create or edit them |
| `list_notes` | `boardId` | Board-level free-positioned markdown notes. Writable via `add_note` / `update_note` / `remove_note` |
| `find_nodes` | `screenId, ref?, snippetId?, id?, classContains?, prop?, propValue?, limit?` | Query a screen tree for matching nodes (filters AND together). Returns `{ matches: [{ path, kind, ref, id?, className?, textPreview?, childCount }], total }` — locate targets for path-accepting tools without fetching and walking the whole tree |

### Tree mutations

A screen has one tree. Path-accepting tools target nodes within that screen's tree.

| Tool | Args |
|---|---|
| `add_node` | `screenId, parentPath, componentRef, id?, props?, children?, index?` — `children` accepts full subtrees so an agent can build a feature card in one call. Pass `id` for a stable `@id` anchor |
| `update_props` | `screenId, path?, propPatch?` OR `patches: [{ path, propPatch }]` — shallow prop merge (null removes a key; className is a prop like any other). `patches` applies many nodes in one atomic write. Successful calls may carry advisory `propWarnings` |
| `override_snippet_props` | `screenId, path, innerPath, propPatch` — patch props on one node *inside* a snippet instance's body (path = instance locator; innerPath = `"@id"` of a body node (preferred — survives restructures), dotted index, or "" for root). Persists as `$overrides` on the instance; applied after param substitution at render; emit_code inlines overridden instances |
| `move_node` | `screenId, fromPath, toParent, toIndex?` |
| `remove_node` | `screenId, path` |
| `inspect` | `screenId, path, innerPath?` — returns SSR'd HTML, resolved className list, `$ref`, and resolved props for the node. When `path` resolves to a snippet instance the body is rendered with its args / `$overrides` / `$extraClassName` applied; `innerPath` (`"@id"`, dotted index, or "" for the body root — the same scheme as `override_snippet_props`) drills into one body node. Omitting `innerPath` on an instance inspects the body root and returns a `note` on how to drill in |
| `audit` | `screenId?` OR `snippetId?` (exactly one), `theme?` — dark-mode audit; coverage + per-node problems with token suggestions. With a named theme that has no `colorsDark`, the result flags coverage as informational |
| `set_node_id` | `screenId, path, id` — assign / rename / clear (`id: null`) a node's stable `$id` anchor. Per-screen uniqueness is enforced; collisions return `IdConflict` |
| `validate_classes` | `classes: string[]` — answers "do these Tailwind candidates compile under the active JIT?" Useful before reaching for arbitrary `shadow-[...]` / `bg-[...]` forms. Theme-aware (knows the folder's `palette` + `custom_css`). A class that compiles but references a CSS var that the design system never declares stays `valid: true` and carries a `warning` — it paints a runtime fallback, not the intended token (e.g. an imported `palette` value left pointing at an undefined var) |

### Screen lifecycle

| Tool | Args | Notes |
|---|---|---|
| `add_screen` | `name, id?, fromScreenId?, tree?` | Creates a screen. Pass `fromScreenId` to clone an existing screen's tree, or `tree` to supply one explicitly. Empty by default. Does *not* place the screen on the board — that's a separate, intentional step |
| `update_screen` | `screenId, patch` | Sparse patch — currently only `name` is patchable; screen id stays stable |
| `remove_screen` | `screenId` | Refuses to remove the last screen; also refuses if any frame on the board references it (returns the `frameIds[]` so the agent can remove them first); undoable via `/api/undo` (canvas ⌘Z) |

### Board lifecycle

Boards are the canvases of a design folder; one folder has many. Each board owns its own frames + groups and persists as `boards/<id>.json`.

| Tool | Args | Notes |
|---|---|---|
| `add_board` | `name, id?` | Create a new empty board. Id is derived from `name` if omitted |
| `update_board` | `boardId, patch` | Sparse patch on `name` (only field today) |
| `remove_board` | `boardId` | Refuses to remove the last board (returns `LastBoard`). Undoable |

### Canvas notes

Board-level sticky notes in board coordinates (the same space as frame `x`/`y`). The agent uses them for guidance that belongs next to frames — tour steps, review remarks, handoff context. Node-anchored *annotations* remain designer-authored; the agent reads those via `list_annotations`.

| Tool | Args |
|---|---|
| `add_note` | `boardId, x, y, width?, body` — markdown-lite body |
| `update_note` | `boardId, noteId, patch: { x?, y?, width?, body? }` |
| `remove_note` | `boardId, noteId` |
| `add_annotation` | `screenId, path, body, collapsed?` — pin agent-authored markdown to a node (author: "agent") |
| `remove_annotation` | `screenId, annotationId` — agent-authored only; user annotations are read-only to agents |

### Assets & batching

| Tool | Args |
|---|---|
| `upload_asset` | `filename, data (base64), overwrite?` — writes into `assets/`, served at `/assets/<name>`; the agent authors SVG/raster art itself (max 5MB) |
| `batch` | `calls: [{ tool, args }], atomic?` — multi-mutation envelope. Atomic by default: first error rolls back every touched resource (disk + memory + undo history) and reports `rolledBack: true`. `atomic: false` keeps completed work |

### Frame / group lifecycle

Frames are placements of screens on a chosen board. Multiple frames of the same screen always render the same tree at different sizes — that's the sync model.

| Tool | Args | Notes |
|---|---|---|
| `add_frame` | `boardId, screenId, x?, y?, w, h, label?, group?, id?` | Drop a frame for a screen at a given size + position on a specific board. Position defaults to a free spot on the board if `x`/`y` omitted |
| `update_frame` | `boardId, frameId, patch` | Sparse: `x`, `y`, `w`, `h`, `label`, `group` (pass `null` to clear label/group) |
| `update_frames` | `boardId, patches: [{ frameId, patch }]` | Atomic bulk update on a single board — single persist, single broadcast, single undo entry. Use when laying out many frames together |
| `remove_frame` | `boardId, frameId` | Removes the frame placement; the underlying screen is untouched |
| `add_group` | `boardId, name, color?, id?` | Create a board group (visual tag for related frames — "marketing flow", "settings flow") |
| `update_group` | `boardId, groupId, patch` | Sparse: `name`, `color` (pass `color: null` to clear) |
| `remove_group` | `boardId, groupId` | Frames in the group are not deleted — they're un-grouped |

### Snippets

Snippets are named reusable subtrees with typed parameters. A snippet lives in `design/snippets/<id>.json`; screens reference it with a `$snippet` node and pass `args` for each declared param. Inside the snippet body, `$param` placeholder nodes substitute their argument value at render time, and `$if` branches pick `then` / `else` based on the truthiness of a named arg.

`params` is `[{ name, type, default?, enum?, min?, max?, step?, description? }]` where `type` is one of:

- `string` — text input
- `number` — numeric input (honors `min` / `max` / `step` in the inspector)
- `boolean` — checkbox; pair with `$if` for branching
- `icon` — lucide icon picker (string-valued)
- `color` — color swatch (string-valued)
- `enum` — select from the `enum` array
- `node` — subtree slot (a full Node value passed by the instance — useful for icon blocks, overlays, etc.)

| Tool | Args | Notes |
|---|---|---|
| `add_snippet` | `id?, name, params, tree` | `tree` may contain `$param` placeholder nodes and `$if` branches |
| `update_snippet` | `snippetId, patch` | Sparse patch on `name`, `params`, `tree`, or `innerPatch` (`{ innerPath, propPatch }` — patch one body node's props in place, the definition-level counterpart of `override_snippet_props`; shared by all instances, no full-tree resend). All screens referencing the snippet rebroadcast |
| `remove_snippet` | `snippetId` | Refuses if any screen instantiates it; returns the referencing screenIds so the agent can clean up first |
| `instantiate_snippet` | `screenId, parentPath, snippetId, args, id?, extraClassName?, overrides?, index?` | Adds a `$snippet` node — opaque from outside. Pass `id` for a stable anchor; `extraClassName` to layer one-off Tailwind classes onto the snippet body's root; `overrides` (`{ "<innerSelector>": { props } }`, same field `override_snippet_props` patches) to set per-instance interior props — the active nav item, a red badge — at placement, no follow-up call |
| `update_snippet_args` | `screenId, path, argPatch?, extraClassName?` | Patch an instance's `args` map (`null` removes a key); also patches the instance's `extraClassName` override (`null` clears) |

### Theme operations

| Tool | Args | Notes |
|---|---|---|
| `set_token` | `path, value` or `tokens, theme?` | Mutates tokens at dot-paths (`colors.primary.DEFAULT`); bulk via `tokens: { <path>: <value> }`. The full theme is schema-validated after each patch; returns the applied paths |
| `add_theme` | `name, from?, overwrite?` — clone a named theme to `theme/<name>.json`; boards pin it via `update_board { patch: { theme } }`, renders/screenshots via their `theme` param |
| `list_themes` | — | named themes + which boards use each |
| `set_fonts` | `fonts: [{ role, family, fallback?, google? }], theme?` — each role becomes `--font-<role>` + a `font-<role>` utility; `google` loads the family in design mode and emits an @import in globals.css |
| `custom_css` | `css?` — read (omit css) or replace `theme/custom.css`; injected into every render and appended to emitted globals.css |
| `apply_preset` | `presetName` | Switches the active theme to a named preset. Ships with `default-light`, `default-dark`, `violet`, `emerald`, `amber`, `rose`, `indigo`, `ocean`, `slate`, `forest`, `sunset`, `plum` |
| `derive_palette_from_color` | `seedColor, name?` | Generates an OKLCH-based palette from a seed (`#hex`, `oklch()`, `rgb()`, …). Foreground/background contrast is auto-adjusted to WCAG AA |
| `score_theme_contrast` | `mode?` | Score WCAG contrast ratios for the active theme's salient color pairs in both light and dark palettes (each result carries `mode`); pass `mode` to score one. Returns `{ summary, results: [{ label, fg, bg, ratio, tier: "AAA" \| "AA" \| "AAlarge" \| "Fail" }] }`. Use after a derive / preset to confirm accessibility before shipping |
| `import_theme` | `css?` OR `cssPath?`, `theme?`, `apply?` | Code-to-design: seed the theme from a host app's stylesheet. Parses shadcn-convention `:root`/`.dark` custom props (raw HSL triplets or any CSS color) and Tailwind v4 `@theme` `--color-*` vars (var() indirection resolved), plus `--radius` and `--font-*` roles. With a `cssPath`, also ingests the nearby tailwind.config `theme.extend` — brand `colors`→palette, named `spacing`→spacing tokens (so `w-icon-rail`/`h-header` resolve), `boxShadow`→shadows, `fontFamily`→font roles, `keyframes`+`animation`→`--animate-*`. Undeclared slots keep their current values. Dry-run by default — returns `changes: [{ token, from, to }]`; `apply: true` persists |

### Visualization

| Tool | Args | Returns |
|---|---|---|
| `screenshot` | `screenId, w?, h?, mode?: "light" \| "dark" \| "compare", fullPage?: boolean, scale?: 0.25–1, path?, theme?, diff?, resetBaseline?, fitFrames?` — `path` captures a single node; `theme` renders with a named theme; `diff: true` compares to the previous same-params capture (tiered result: text-only on zero change, highlight crop + changed-node paths on small change, full image on large); `fitFrames: true` resizes any board frame that clips this screen up to its content height (returns `fittedFrames`) | Base64 PNG via Playwright. `compare` renders light + dark side-by-side in one image. Defaults `fullPage: true` so tall screens aren't clipped. `w`/`h` default to the desktop viewport preset; the screen's tree renders responsively at that size |
| `render_snippet` | `snippetId, args?, extraClassName?, viewport?, mode?, scale?` | Render a snippet in isolation (no host screen) and return a PNG. Defaults to a 480×640 viewport. Useful for iterating on snippet visuals before stamping |
| `compare_to_url` | `screenId, url, w?, h?, mode?, fullPage?, scale?, theme?, image?, settleTimeoutMs?, storageStatePath?, cookies?, localStorage?, fitFrames?` | Code-to-design fidelity check: render the screen and screenshot a live URL (the app page being ported) at the same viewport, then pixel-diff. Returns `{ similarity, changedRatio, heightDelta, regions }` with each region mapped to the screen node under it, plus a side-by-side PNG (URL left, Velloo right; `image: false` for metrics only). `scale` defaults 0.5. `mode: "dark"` renders the Velloo side dark **and** best-effort drives the target page dark (prefers-color-scheme + `.dark`/`data-theme` on `<html>` + `localStorage.theme`) so dark fidelity checks against the app's real dark theme. `settleTimeoutMs` (default 8000) caps the network-quiet wait before capture — raise it for data-heavy pages that paint a spinner first. `storageStatePath`/`cookies`/`localStorage` inject an authenticated session past login walls. `fitFrames: true` resizes any board frame that clips this screen up to its content height (returns `fittedFrames`) |

### Codegen and export

| Tool | Args |
|---|---|
| `emit_code` | `screenId, componentsAlias?` — returns a structured JSX-shaped intermediate representation intended for the agent to read and transform into the user's app code (using their conventions, routing, providers). `componentsAlias` overrides the per-folder default. **Not paste-ready output.** |
| `emit_snippet` | `snippetId, componentsAlias?` — same idea, scoped to a single snippet. Returns PascalCase component name, typed params, JSX body |
| `emit_theme` | `outputDir, apply?: boolean, cssOnly?: boolean` — generates Tailwind v4 `globals.css` (and optionally `tailwind.config.ts`). Defaults to dry-run; set `apply: true` to write. Direct user-facing artifact; agent does not need to transform it |

## Path addressing

Every path-accepting tool accepts a **locator** — either of:

- **Path array** — integer indices from the screen tree root. `[0, 2, 1]` = first child, third grandchild, second great-grandchild. Cheap to serialize and unambiguous, but brittle: a sibling insertion above shifts every later path.
- **`@id` reference** — the string `"@hero-cta"` resolves to whichever node carries `$id: "hero-cta"`. Stable across sibling insertions and deletions.

Agents assign ids two ways: pass `id: "hero-cta"` when creating a node (`add_node`, `instantiate_snippet`) or call `set_node_id` later. Per-screen uniqueness is enforced at persist time; collisions surface as `IdConflict`.

Edits return the resolved path of the affected node so the agent can chain operations without a re-read.

**Snippet instances are opaque.** A `$snippet` node has a path and may carry its own `$id`, but the structure rendered inside it is not addressable from the screen. To edit the contents, edit the snippet body itself (see below); every instance updates.

### Editing a snippet body

Every tree mutation also accepts a virtualized `screenId` of the form `"snippet:<snippetId>"`. The mutation layer routes those writes through the snippet's body — same impl, same path semantics, same error model. So:

- `update_props({ screenId: "snippet:feature-row", path: [0], propPatch: { className: "p-6" } })` patches the snippet body's root node.
- `add_node({ screenId: "snippet:feature-row", parentPath: [], componentRef: "Icon", props: { name: "Sparkles" }, id: "leading-icon" })` adds a child to the body's root and assigns a stable id.
- `move_node`, `remove_node`, `set_node_id`, `instantiate_snippet`, `update_snippet_args`, and `update_props`'s bulk `patches` form all work the same way.

Two things to know:

- Edits broadcast as `snippet-changed` (not `screen-changed`), and the `update_snippet` lock guards them so a body edit and a wholesale `update_snippet` can't race.
- `$param` refs and `$if` branches are not `ComponentNode`s — `add_node` can't insert them. To add a `$param` placeholder or `$if` branch, use `update_snippet` with a patched `tree`.

The canvas's snippet editor view uses exactly this surface — the Inspector targets `screenId: "snippet:<id>"` for every mutation it commits.

See `decisions.md` #21 for the rationale.

### Locator-aware tools

`add_node`, `update_props` (single and `patches` bulk), `move_node`, `remove_node`, `inspect`, `instantiate_snippet`, `update_snippet_args`, `set_node_id` — every `path`/`parentPath`/`fromPath`/`toParent` field accepts either a path array or an `@id` string. `set_node_id` targets `ComponentNode` and `SnippetInstance` — param refs can't carry ids.

## Advisory prop warnings

`add_node`, `update_props`, and `add_screen` validate props against the active library's manifest after the mutation succeeds and attach a `propWarnings: string[]` field to the result when something looks off — a typo'd prop name (with nearest-known suggestions), an enum value outside the declared set, or a boolean/number type mismatch. Warnings never fail the mutation: DOM passthrough props (`data-*`, `aria-*`, `className`, …) are exempt, components that declare no manifest props skip validation entirely, and `$param`/`$if` substitution values are ignored. Treat a warning as "this will probably render wrong" and self-correct in the same turn.

## Error model

Errors are discriminated unions with a `kind` field. Every mutation returns `Result<T, MutationError>`; routes map error variants to HTTP status codes and the MCP layer returns them as structured tool errors.

| `kind` | Meaning |
|---|---|
| `ScreenNotFound` | The named screen doesn't exist |
| `BoardNotFound` | The named board doesn't exist in the folder |
| `FrameNotFound` | The named frame doesn't exist on the given board; carries `boardId` + `frameId` |
| `GroupNotFound` | The named group doesn't exist on the given board; carries `boardId` + `groupId` |
| `UnknownComponent` | `componentRef` not in the active palette; carries `suggestions[]` by Levenshtein distance |
| `InvalidPath` | Path doesn't resolve in the screen tree |
| `InvalidMove` | `move_node` would create a cycle or move into self |
| `LastScreen` | `remove_screen` refuses when only one screen is left |
| `LastBoard` | `remove_board` refuses when only one board is left |
| `ScreenInUse` | `remove_screen` refuses when frames reference it; carries `usage: { boardId, frameIds[] }[]` |
| `ScreenIdConflict` | `add_screen` id collides with an existing screen |
| `ScreenIdExhausted` | Couldn't derive a unique screen id from the supplied name |
| `BoardIdConflict` | `add_board` id collides with an existing board |
| `BoardIdExhausted` | Couldn't derive a unique board id from the supplied name |
| `FrameIdConflict` | `add_frame` id collides with an existing frame on that board |
| `GroupIdConflict` | `add_group` id collides with an existing group on that board |
| `BadRequest` | Zod validation failed at the route boundary; carries the issue list |
| `SnippetNotFound` | The named snippet doesn't exist |
| `SnippetParamMismatch` | `args` to `instantiate_snippet` don't match the declared `params` (missing required, unknown extras, type mismatch) |
| `SnippetCycle` | Snippet body would reference itself (directly or transitively) |
| `SnippetInUse` | `remove_snippet` refuses when screens still instantiate it; carries the referencing `screenIds[]` |
| `SnippetIdConflict` | `add_snippet` id collides with an existing snippet |
| `IdNotFound` | An `@id` locator didn't resolve to any node in the screen; carries `id` |
| `IdConflict` | Two nodes in the same screen share an `$id`; carries `id` + `paths[]` |
| `AnnotationConflict` | Two annotations on the same screen target the same locator |
| `AnnotationNotFound` | Annotation id doesn't exist on the named screen |
| `CanvasNoteNotFound` | Note id doesn't exist on any board |

## Initialize handshake

Server returns the standard MCP `initialize` response with concrete agent nudges in `instructions`. The shipped text lives in `packages/server/src/mcp/server.ts` (search for `INSTRUCTIONS`); summarized:

- **What Velloo is.** A pinned shadcn snapshot embedded in the binary; the design folder ships pure data. Designs are static — click handlers, routing, and forms are no-op.
- **First-pass discovery.** Before composing screens, call `list_components` (use `mode: "summary"` first — the full schema is large), `get_theme`, `list_snippets`, and `list_boards`. For an overview of an existing screen, use `get_screen mode: "outline"` (compact `ref + $id + classSnippet` tree) before pulling the full JSON.
- **Velloo is the design source; you are the bridge to code.** When asked to implement, call `emit_code` (per screen) or `emit_snippet` and write the real file in the user's stack — Velloo's output is IR, not finished JSX.
- **Prefer semantic theme tokens** (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `bg-accent`) over raw Tailwind palette colors so designs auto-flip under `screenshot mode: "dark"` and survive theme changes. Use raw palette only for *intentional* accent colors that should not theme-flip — and mark those nodes with `data-accent: "ok"` so `inspect_dark_diff` exempts them.
- **`inspect_dark_diff` is a triage signal, not a gate.** Read the per-node `problems[]` and decide; the coverage number is a guide, not a target.
- **Use `add_node`'s `children` array** to land whole subtrees in one call. The bulk forms (`update_props` with `patches`, `update_frames`) collapse N round-trips into one persist + one undo entry; `batch` covers multi-tool sequences atomically.
- **Use `@id` locators** for anchors you reference more than once. Pass `id: "hero-cta"` to `add_node` / `instantiate_snippet`, or call `set_node_id` to retroactively name a node. Ids survive sibling insertions.
- **Snippet instances are opaque.** Design for variation up-front: boolean params + `$if`, `enum` params for full-className swaps, `node` params for slot composition, `extraClassName` for one-off per-instance tweaks.
- **Always call `render_snippet` after `add_snippet`** — `$param` wiring bugs and `$if` truthy-coercion mistakes are silent at definition time and only surface at instantiation.
- **One tree per screen.** Viewport size is a property of each `frame` placement. Different viewport renderings of the same screen → multiple frames pointing at the same screen (edits sync). Different layouts per breakpoint → separate screens with their own frames.
- **`screenshot mode: "compare"`** renders light + dark side-by-side in one PNG — the fastest signal that the design actually adapts.
- **Annotations are guidance.** `list_annotations(screenId)` returns markdown notes the designer attached to specific nodes. Each annotation carries a `resolved` path (null when the targeted node has been removed — low-priority, the note is stale). Read-only.
