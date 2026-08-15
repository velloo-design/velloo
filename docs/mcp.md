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
| `list_notes` | `boardId` | Board-level free-positioned markdown notes (designer-authored, read-only) |

### Tree mutations

A screen has one tree. Path-accepting tools target nodes within that screen's tree.

| Tool | Args |
|---|---|
| `add_node` | `screenId, parentPath, componentRef, id?, props?, children?, index?` — `children` accepts full subtrees so an agent can build a feature card in one call. Pass `id` for a stable `@id` anchor |
| `update_props` | `screenId, path, propPatch` |
| `update_props_bulk` | `screenId, patches: [{path, propPatch}]` — atomic bulk variant; single persist + broadcast + history entry |
| `move_node` | `screenId, fromPath, toParent, toIndex?` |
| `remove_node` | `screenId, path` |
| `inspect` | `screenId, path` — returns SSR'd HTML, resolved className list, `$ref`, and resolved props for the node |
| `inspect_dark_diff` | `screenId` — audit color classes for dark-mode awareness. Scores **only color-bearing classes**; structural utilities (`border-b`, `ring-0`, `shadow-none`, `text-xl`, `bg-transparent`, `text-current`) are exempt by design. Set `data-accent` (any truthy value) on a node's props to exempt it entirely. Returns coverage 0..1, per-node `raw[]` classes that won't theme-flip, and `suggestions{}` for obvious semantic-token replacements. Treat the score as a triage signal, not a gate |
| `inspect_dark_diff_snippet` | `snippetId` — same audit scoped to a snippet body. Catches bad raw-color patterns at definition time, before stamping |
| `apply_classes` | `screenId, path, classes` — Tailwind class edit on a node |
| `apply_classes_bulk` | `screenId, patches: [{path, classes}]` — atomic bulk apply_classes; useful for sweeping a screen through a styling change |
| `set_node_id` | `screenId, path, id` — assign / rename / clear (`id: null`) a node's stable `$id` anchor. Per-screen uniqueness is enforced; collisions return `IdConflict` |
| `validate_classes` | `classes: string[]` — answers "do these Tailwind candidates compile under the active JIT?" Useful before reaching for arbitrary `shadow-[...]` / `bg-[...]` forms |

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
| `update_snippet` | `snippetId, patch` | Sparse patch on `name`, `params`, or `tree`; all screens referencing the snippet rebroadcast |
| `remove_snippet` | `snippetId` | Refuses if any screen instantiates it; returns the referencing screenIds so the agent can clean up first |
| `instantiate_snippet` | `screenId, parentPath, snippetId, args, id?, extraClassName?, index?` | Adds a `$snippet` node — opaque from outside. Pass `id` for a stable anchor; `extraClassName` to layer one-off Tailwind classes onto the snippet body's root |
| `update_snippet_args` | `screenId, path, argPatch?, extraClassName?` | Patch an instance's `args` map (`null` removes a key); also patches the instance's `extraClassName` override (`null` clears) |

### Theme operations

| Tool | Args | Notes |
|---|---|---|
| `set_token` | `path, value` | Mutates one token at a dot-path (`colors.primary.DEFAULT`). The full theme is schema-validated after the patch |
| `apply_preset` | `presetName` | Switches the active theme to a named preset. Ships with `default-light`, `default-dark`, `violet`, `emerald`, `amber`, `rose`, `indigo`, `ocean`, `slate`, `forest`, `sunset`, `plum` |
| `derive_palette_from_color` | `seedColor, name?` | Generates an OKLCH-based palette from a seed (`#hex`, `oklch()`, `rgb()`, …). Foreground/background contrast is auto-adjusted to WCAG AA |
| `match_vibe` | `description, useAi?: boolean` | Maps a vibe description ("playful", "corporate", "forest") to a seed color via a curated table, then derives + applies a palette. Set `useAi: true` to ask Claude Haiku for a seed color when `ANTHROPIC_API_KEY` is set |
| `match_image` | `imagePath` | Extracts a palette from an image (vibrant + muted + dark/light variants) and applies a derived theme. Path is relative to `assets/` or absolute |
| `score_theme_contrast` | — | Score WCAG contrast ratios for the active theme's salient color pairs. Returns `{ summary, results: [{ label, fg, bg, ratio, tier: "AAA" \| "AA" \| "AAlarge" \| "Fail" }] }`. Use after a derive / preset / match-vibe to confirm accessibility before shipping |

### Visualization

| Tool | Args | Returns |
|---|---|---|
| `screenshot` | `screenId, w?, h?, mode?: "light" \| "dark" \| "compare", fullPage?: boolean` | Base64 PNG via Playwright. `compare` renders light + dark side-by-side in one image. Defaults `fullPage: true` so tall screens aren't clipped. `w`/`h` default to the desktop viewport preset; the screen's tree renders responsively at that size |
| `render_snippet` | `snippetId, args?, extraClassName?, viewport?, mode?` | Render a snippet in isolation (no host screen) and return a PNG. Defaults to a 480×640 viewport. Useful for iterating on snippet visuals before stamping |

### Codegen and export

| Tool | Args |
|---|---|
| `emit_code` | `screenId, componentsAlias?` — returns a structured JSX-shaped intermediate representation intended for the agent to read and transform into the user's app code (using their conventions, routing, providers). `componentsAlias` overrides the per-folder default. **Not paste-ready output.** |
| `emit_snippet` | `snippetId, componentsAlias?` — same idea, scoped to a single snippet. Returns PascalCase component name, typed params, JSX body |
| `emit_theme` | `outputDir, apply?: boolean, cssOnly?: boolean` — generates Tailwind v4 `globals.css` (and optionally `tailwind.config.ts`). Defaults to dry-run; set `apply: true` to write. Direct user-facing artifact; agent does not need to transform it |

### Generate (AI assets)

| Tool | Args | Notes |
|---|---|---|
| `generate_svg` | `prompt, filename?, viewBox?, color?` | Generate inline SVG via Claude Haiku. Returns `{ content, viewBox, assetPath, node: { $ref: "SVG", props: { … } } }` — drop `node` straight into `add_node`. Set `filename` to also persist under `assets/`. Requires `ANTHROPIC_API_KEY` |
| `generate_image` | `prompt, filename?, aspect?, width?` | Default: Picsum URL seeded by prompt hash (deterministic, no API key). With `FAL_KEY` + `filename`, calls fal.ai flux-schnell and writes the binary to `assets/<filename>.png`. Returns `{ src, alt, aspect, node: { $ref: "Image", props: { … } } }` |

## Path addressing

Every path-accepting tool accepts a **locator** — either of:

- **Path array** — integer indices from the screen tree root. `[0, 2, 1]` = first child, third grandchild, second great-grandchild. Cheap to serialize and unambiguous, but brittle: a sibling insertion above shifts every later path.
- **`@id` reference** — the string `"@hero-cta"` resolves to whichever node carries `$id: "hero-cta"`. Stable across sibling insertions and deletions.

Agents assign ids two ways: pass `id: "hero-cta"` when creating a node (`add_node`, `instantiate_snippet`) or call `set_node_id` later. Per-screen uniqueness is enforced at persist time; collisions surface as `IdConflict`.

Edits return the resolved path of the affected node so the agent can chain operations without a re-read.

**Snippet instances are opaque.** A `$snippet` node has a path and may carry its own `$id`, but the structure rendered inside it is not addressable from the screen. To edit the contents, edit the snippet body itself; every instance updates.

### Locator-aware tools

`add_node`, `update_props`, `apply_classes`, `move_node`, `remove_node`, `inspect`, `instantiate_snippet`, `update_snippet_args`, `apply_classes_bulk`, `update_props_bulk`, `set_node_id` — every `path`/`parentPath`/`fromPath`/`toParent` field accepts either a path array or an `@id` string. `set_node_id` targets `ComponentNode` and `SnippetInstance` — param refs can't carry ids.

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
- **Use `add_node`'s `children` array** to land whole subtrees in one call. The bulk variants (`update_props_bulk`, `apply_classes_bulk`, `update_frames`) collapse N round-trips into one persist + one undo entry.
- **Use `@id` locators** for anchors you reference more than once. Pass `id: "hero-cta"` to `add_node` / `instantiate_snippet`, or call `set_node_id` to retroactively name a node. Ids survive sibling insertions.
- **Snippet instances are opaque.** Design for variation up-front: boolean params + `$if`, `enum` params for full-className swaps, `node` params for slot composition, `extraClassName` for one-off per-instance tweaks.
- **Always call `render_snippet` after `add_snippet`** — `$param` wiring bugs and `$if` truthy-coercion mistakes are silent at definition time and only surface at instantiation.
- **One tree per screen.** Viewport size is a property of each `frame` placement. Different viewport renderings of the same screen → multiple frames pointing at the same screen (edits sync). Different layouts per breakpoint → separate screens with their own frames.
- **`screenshot mode: "compare"`** renders light + dark side-by-side in one PNG — the fastest signal that the design actually adapts.
- **Annotations are guidance.** `list_annotations(screenId)` returns markdown notes the designer attached to specific nodes. Each annotation carries a `resolved` path (null when the targeted node has been removed — low-priority, the note is stale). Read-only.
