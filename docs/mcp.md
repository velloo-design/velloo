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
| `get_board` | — | `{ frames: [...], groups: [...] }` — frame placement on the canvas |
| `list_components` | `filter?, mode?: "summary" \| "full"` | `[{ id, props, category, summary }]` — summary mode returns just `{ id, summary, category }` to avoid blowing the token cap on first call |
| `list_snippets` | — | `[{ id, name, params }]` |
| `get_snippet` | `snippetId` | full snippet JSON (`{ id, name, params, tree }`) |
| `get_theme` | — | full token tree |
| `list_annotations` | `screenId` | Designer-authored markdown annotations on a screen. Each carries a `target: { locator }` and a `resolved` path (null when the targeted node has been removed — treat as low-priority). Read-only: agents can act on annotations but not create or edit them |
| `list_notes` | — | Board-level free-positioned markdown notes (designer-authored, read-only) |

### Tree mutations

A screen has one tree. Path-accepting tools target nodes within that screen's tree.

| Tool | Args |
|---|---|
| `add_node` | `screenId, parentPath, componentRef, id?, props?, children?, index?` — `children` accepts full subtrees so an agent can build a feature card in one call. Pass `id` for a stable `@id` anchor |
| `update_props` | `screenId, path, propPatch` |
| `update_props_bulk` | `screenId, patches: [{path, propPatch}]` — atomic bulk variant; single persist + broadcast + history entry |
| `move_node` | `screenId, fromPath, toParent, toIndex?` |
| `remove_node` | `screenId, path` |
| `inspect` | `screenId, path` — returns rendered DOM + computed styles |
| `inspect_dark_diff` | `screenId` — audit color classes for dark-mode awareness. Scores **only color-bearing classes**; structural utilities (`border-b`, `ring-0`, `shadow-none`, `text-xl`, `bg-transparent`, `text-current`) are exempt by design. Set `data-accent` (any truthy value) on a node's props to exempt it entirely. Returns coverage 0..1, per-node `raw[]` classes that won't theme-flip, and `suggestions{}` for obvious semantic-token replacements. Treat the score as a triage signal, not a gate |
| `inspect_dark_diff_snippet` | `snippetId` — same audit scoped to a snippet body. Catches bad raw-color patterns at definition time, before stamping |
| `apply_classes` | `screenId, path, classes` — Tailwind class edit on a node |
| `apply_classes_bulk` | `screenId, patches: [{path, classes}]` — atomic bulk apply_classes; useful for sweeping a screen through a styling change |
| `validate_classes` | `classes: string[]` — answers "do these Tailwind candidates compile under the active JIT?" Useful before reaching for arbitrary `shadow-[...]` / `bg-[...]` forms |

### Screen lifecycle

| Tool | Args | Notes |
|---|---|---|
| `add_screen` | `name, id?, fromScreenId?, tree?` | Creates a screen. Pass `fromScreenId` to clone an existing screen's tree, or `tree` to supply one explicitly. Empty by default. Does *not* place the screen on the board — that's a separate, intentional step |
| `update_screen` | `screenId, patch` | Sparse patch — currently only `name` is patchable; screen id stays stable |
| `remove_screen` | `screenId` | Refuses to remove the last screen; also refuses if any frame on the board references it (returns the `frameIds[]` so the agent can remove them first); undoable via `/api/undo` (canvas ⌘Z) |

### Board / frame lifecycle

Frames are placements of screens on the canvas. Multiple frames of the same screen always render the same tree at different sizes — that's the sync model.

| Tool | Args | Notes |
|---|---|---|
| `add_frame` | `screenId, x, y, w, h, label?, group?, id?` | Drop a frame for a screen at a given size + position. Position defaults to a free spot on the board if `x`/`y` omitted |
| `update_frame` | `frameId, patch` | Sparse: `x`, `y`, `w`, `h`, `label`, `group` (pass `null` to clear group) |
| `update_frames` | `patches: [{ frameId, patch }]` | Atomic bulk update — single persist, single broadcast, single undo entry. Use when laying out many frames together |
| `remove_frame` | `frameId` | Removes the frame placement; the underlying screen is untouched |
| `add_group` | `name, color?, id?` | Create a board group (visual tag for related frames — "marketing flow", "settings flow") |
| `update_group` | `groupId, patch` | Sparse: `name`, `color` |
| `remove_group` | `groupId` | Frames in the group are not deleted — they're un-grouped |

### Snippets

Snippets are named reusable subtrees with typed parameters. A snippet lives in `design/snippets/<id>.json`; screens reference it with a `$snippet` node and pass `args` for each declared param. Inside the snippet body, `$param` placeholder nodes substitute their argument value at render time.

| Tool | Args | Notes |
|---|---|---|
| `add_snippet` | `id?, name, params, tree` | `params` is `[{ name, type, default? }]`; `tree` may contain `$param` placeholder nodes |
| `update_snippet` | `snippetId, patch` | Sparse patch on `name`, `params`, or `tree`; all screens referencing the snippet rebroadcast |
| `remove_snippet` | `snippetId` | Refuses if any screen instantiates it; returns the referencing screenIds so the agent can clean up first |
| `instantiate_snippet` | `screenId, parentPath, snippetId, args, id?, extraClassName?, index?` | Adds a `$snippet` node — opaque from outside. Pass `id` for a stable anchor; `extraClassName` to layer one-off Tailwind classes onto the snippet body's root |
| `update_snippet_args` | `screenId, path, argPatch?, extraClassName?` | Patch an instance's `args` map (`null` removes a key); also patches the instance's `extraClassName` override (`null` clears) |

### Theme operations

| Tool | Args | Notes |
|---|---|---|
| `set_token` | `path, value` | Mutates one token |
| `apply_preset` | `presetName` | Switches entire theme |
| `derive_palette_from_color` | `seedColor, name?` | Generates accessible scale via OKLCH |
| `match_vibe` | `description` | Agent-driven theme synthesis (e.g. "playful, energetic, mid-saturation") |
| `match_image` | `imagePath` | Extracts palette from an image |

### Visualization

| Tool | Args | Returns |
|---|---|---|
| `screenshot` | `screenId, w?, h?, mode?: "light" \| "dark" \| "compare", fullPage?: boolean` | Base64 PNG via Playwright. `compare` renders light + dark side-by-side in one image. Defaults `fullPage: true` so tall screens aren't clipped. `w`/`h` default to the desktop viewport preset; the screen's tree renders responsively at that size |
| `render_snippet` | `snippetId, args?, extraClassName?, viewport?, mode?` | Render a snippet in isolation (no host screen) and return a PNG. Useful for iterating on snippet visuals before stamping |

### Codegen and export

| Tool | Args |
|---|---|
| `emit_code` | `screenId` — returns a structured JSX-shaped intermediate representation intended for the agent to read and transform into the user's app code (using their conventions, routing, providers). **Not paste-ready output.** |
| `emit_theme` | `outputPath` — writes `tailwind.config.ts` + `globals.css` (diff mode). Direct user-facing artifact; agent does not need to transform it. |

## Path addressing

Every path-accepting tool accepts a **locator** — either of:

- **Path array** — integer indices from the screen tree root. `[0, 2, 1]` = first child, third grandchild, second great-grandchild. Cheap to serialize and unambiguous, but brittle: a sibling insertion above shifts every later path.
- **`@id` reference** — the string `"@hero-cta"` resolves to whichever node carries `$id: "hero-cta"`. Stable across sibling insertions and deletions.

Agents assign ids two ways: pass `id: "hero-cta"` when creating a node (`add_node`, `instantiate_snippet`) or call `set_node_id` later. Per-screen uniqueness is enforced at persist time; collisions surface as `IdConflict`.

Edits return the resolved path of the affected node so the agent can chain operations without a re-read.

**Snippet instances are opaque.** A `$snippet` node has a path and may carry its own `$id`, but the structure rendered inside it is not addressable from the screen. To edit the contents, edit the snippet body itself; every instance updates.

### Locator-aware tools

`add_node`, `update_props`, `apply_classes`, `move_node`, `remove_node`, `inspect`, `instantiate_snippet`, `update_snippet_args`, `apply_classes_bulk`, `update_props_bulk`, `set_node_id` — every `path`/`parentPath`/`fromPath`/`toParent` field accepts either a path array or an `@id` string.

| Tool | Args | Notes |
|---|---|---|
| `set_node_id` | `screenId, path, id` | Assign / rename / clear (`id: null`) a node's stable anchor. Targets `ComponentNode` and `SnippetInstance` — param refs can't carry ids |

## Error model

Errors are discriminated unions with a `kind` field. Every mutation returns `Result<T, MutationError>`; routes map error variants to HTTP status codes and the MCP layer returns them as structured tool errors.

| `kind` | Meaning |
|---|---|
| `ScreenNotFound` | The named screen doesn't exist |
| `FrameNotFound` | The named frame doesn't exist on the board |
| `UnknownComponent` | `componentRef` not in the active palette; carries `suggestions[]` by Levenshtein distance |
| `InvalidPath` | Path doesn't resolve in the screen tree |
| `InvalidMove` | `move_node` would create a cycle or move into self |
| `LastScreen` | `remove_screen` refuses when only one screen is left |
| `ScreenInUse` | `remove_screen` refuses when frames on the board reference it; carries `frameIds[]` |
| `ScreenIdConflict` | `add_screen` id collides with an existing screen |
| `ScreenIdExhausted` | Couldn't derive a unique screen id from the supplied name |
| `BadRequest` | Zod validation failed at the route boundary; carries the issue list |
| `SnippetNotFound` | The named snippet doesn't exist |
| `SnippetParamMismatch` | `args` to `instantiate_snippet` don't match the declared `params` (missing required, unknown extras, type mismatch) |
| `SnippetCycle` | Snippet body would reference itself (directly or transitively) |
| `SnippetInUse` | `remove_snippet` refuses when screens still instantiate it; carries the referencing `screenIds[]` |
| `SnippetIdConflict` | `add_snippet` id collides with an existing snippet |
| `IdNotFound` | An `@id` locator didn't resolve to any node in the screen; carries `id` |
| `IdConflict` | Two nodes in the same screen share an `$id`; carries `id` + `paths[]` |

## Initialize handshake

Server returns the standard MCP `initialize` response with concrete agent nudges in `instructions`. Working text:

> You are working on a Velloo design folder. Components come from a pinned shadcn snapshot embedded in the Velloo binary; the design folder ships pure data. Designs are static — click handlers, routing, and forms are no-op.
>
> **Mental model:** a **screen** is a responsive React tree (one JSON file). A **frame** is a placement of a screen on the canvas at a chosen size — multiple frames can show the same screen at different sizes and edits always sync because there's one underlying tree. A **board** is the canvas; it holds frames.
>
> **Velloo is the design source; you are the bridge to code.** When the user asks you to implement a design in their app, call `emit_code` for the screen, then write the real file into the user's app using their stack, conventions, routing, providers, and existing component wrappers. Do not paste `emit_code` output directly — it's intermediate representation, not finished JSX.
>
> **Before composing screens**, call `list_components` (use `mode: "summary"` first — the full schema is large) and `get_theme` to understand the available palette and active tokens.
>
> **Prefer semantic theme tokens** (`bg-card`, `text-foreground`, `bg-primary`, `bg-muted`, `border-border`) over raw Tailwind colors (`bg-zinc-900`, `text-white`) so designs auto-adapt to dark mode and theme changes.
>
> **Use responsive Tailwind classes** (`md:`, `lg:`) so a single screen renders well across mobile / tablet / desktop frame sizes. If a layout truly diverges, create a second screen and a second frame — explicit forks, not background sync.
>
> **Use `add_node`'s `children` parameter** to add whole subtrees in one call — every child can be a full node (with its own props + children). One call beats N round-trips.
>
> **Prefer snippets for repeated structure** (feature cards, list items, hero sections). Create the snippet once with `add_snippet`, then call `instantiate_snippet` per occurrence. Edits to the body propagate; arg lists keep instances different. Snippets emit as real React components on `emit_code`.
>
> **New screens are not automatically placed on the board.** After `add_screen`, call `add_frame` to place it on the canvas at a chosen viewport.
>
> **Text content** for `Heading`, `Text`, `Button`, `Badge`, `Label` goes in the `children` prop, not a `text` prop.
>
> **`Icon` takes any lucide-react name** as its `name` prop (e.g. `Sparkles`, `ArrowRight`, `Check`). The list is huge; pick by feel.
>
> **`screenshot`** is available — use it to verify layout when something feels off rather than guessing.
