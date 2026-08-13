# MCP Surface

> Velloo's MCP tool surface for AI agents. Token-efficient by construction.

Designed for token efficiency: every tool is scoped, typed, and operates on small JSON. Compared to Penpot's `execute_code` (raw JS over the entire Plugin API) or Paper's `write_html` (HTML literals), each operation here is a single structural mutation with predictable cost.

A typical design page is 30–80 nodes, ~2–4 KB of JSON. The agent can `get_variant`, plan multiple ops, and apply them in a tight loop with low token spend per turn.

## Tool surface

### Discovery

| Tool | Args | Returns |
|---|---|---|
| `list_pages` | `include_tree?: boolean` | `[{ id, name, variants: [{ id, name, viewport, tree? }] }]`. Pass `include_tree: true` for a single-round-trip overview of the whole design |
| `get_page` | `pageId` | full page JSON |
| `get_variant` | `pageId, variantId` | single variant tree |
| `list_components` | `filter?, mode?: "summary" \| "full"` | `[{ id, props, category, summary }]` — summary mode returns just `{ id, summary, category }` to avoid blowing the token cap on first call |
| `list_snippets` | — | `[{ id, name, params }]` |
| `get_snippet` | `snippetId` | full snippet JSON (`{ id, name, params, tree }`) |
| `get_theme` | — | full token tree |

### Tree mutations

| Tool | Args |
|---|---|
| `add_node` | `pageId, variantId, parentPath, componentRef, id?, props?, children?, index?` — `children` accepts full subtrees so an agent can build a feature card in one call. Pass `id` for a stable `@id` anchor |
| `update_props` | `pageId, variantId, path, propPatch` |
| `update_props_bulk` | `pageId, variantId, patches: [{path, propPatch}]` — atomic bulk variant; single persist + broadcast + history entry |
| `move_node` | `pageId, variantId, fromPath, toParent, toIndex?` |
| `remove_node` | `pageId, variantId, path` |
| `inspect` | `pageId, variantId, path` — returns rendered DOM + computed styles |
| `inspect_dark_diff` | `pageId, variantId` — audit color classes for dark-mode awareness. Returns coverage 0..1, per-node `raw[]` classes that won't theme-flip, and `suggestions{}` for obvious semantic-token replacements |
| `apply_classes` | `pageId, variantId, path, classes` — Tailwind class edit on a node |
| `apply_classes_bulk` | `pageId, variantId, patches: [{path, classes}]` — atomic bulk apply_classes; useful for sweeping a page through a styling change |
| `validate_classes` | `classes: string[]` — answers "do these Tailwind candidates compile under the active JIT?" Useful before reaching for arbitrary `shadow-[...]` / `bg-[...]` forms |

### Page lifecycle

| Tool | Args | Notes |
|---|---|---|
| `add_page` | `name, id?, viewport?` | Creates a page with a single variant in the supplied viewport (defaults to mobile) |
| `update_page` | `pageId, patch` | Sparse patch — only `name` is patchable today; page id stays stable |
| `remove_page` | `pageId` | Refuses to remove the last page; undoable via `/api/undo` (canvas ⌘Z) |

### Variant lifecycle

| Tool | Args | Notes |
|---|---|---|
| `add_variant` | `pageId, fromVariantId?, viewport, name, id?` | Optionally clones an existing variant's tree |
| `update_variant` | `pageId, variantId, patch` | Sparse: `name`, `viewport`, or `position` (pass `position: null` to return to auto-layout) |
| `update_variants` | `pageId, patches: [{ variantId, patch }]` | Atomic bulk variant update — single persist, single broadcast, single undo entry. Use this when laying out multiple variants together |
| `remove_variant` | `pageId, variantId` | Refuses to remove the last variant on a page |

### Snippets

Snippets are named reusable subtrees with typed parameters. A snippet lives in `design/snippets/<id>.json`; pages reference it with a `$snippet` node and pass `args` for each declared param. Inside the snippet body, `$param` placeholder nodes substitute their argument value at render time.

| Tool | Args | Notes |
|---|---|---|
| `add_snippet` | `id?, name, params, tree` | `params` is `[{ name, type, default? }]`; `tree` may contain `$param` placeholder nodes |
| `update_snippet` | `snippetId, patch` | Sparse patch on `name`, `params`, or `tree`; all pages referencing the snippet rebroadcast |
| `remove_snippet` | `snippetId` | Refuses if any page instantiates it; returns the referencing pageIds so the agent can clean up first |
| `instantiate_snippet` | `pageId, variantId, parentPath, snippetId, args, id?, index?` | Adds a `$snippet` node — opaque from outside, internal paths are not addressable. Pass `id` for a stable anchor on the instance |
| `update_snippet_args` | `pageId, variantId, path, argPatch` | Edit an instance's args without touching the snippet body |

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
| `screenshot` | `pageId, variantId, mode?: "light" \| "dark", fullPage?: boolean` | Base64 PNG via Playwright. Defaults `fullPage: true` so tall pages aren't clipped; pass `fullPage: false` to clip to the variant's viewport rectangle |

### Codegen and export

| Tool | Args |
|---|---|
| `emit_code` | `pageId, outputPath` — writes idiomatic shadcn JSX |
| `emit_theme` | `outputPath` — writes `tailwind.config.ts` + `globals.css` (diff mode) |

## Path addressing

Every path-accepting tool accepts a **locator** — either of:

- **Path array** — integer indices from the variant root. `[0, 2, 1]` = first child, third grandchild, second great-grandchild. Cheap to serialize and unambiguous, but brittle: a sibling insertion above shifts every later path.
- **`@id` reference** — the string `"@hero-cta"` resolves to whichever node carries `$id: "hero-cta"`. Stable across sibling insertions and deletions.

Agents assign ids two ways: pass `id: "hero-cta"` when creating a node (`add_node`, `instantiate_snippet`) or call `set_node_id` later. Per-variant uniqueness is enforced at persist time; collisions surface as `IdConflict`. The same id may repeat across variants of the same page — that's intentional: `"@hero-cta"` in mobile + desktop is the same semantic anchor in different renders.

Edits return the resolved path of the affected node so the agent can chain operations without a re-read.

**Snippet instances are opaque.** A `$snippet` node has a path and may carry its own `$id`, but the structure rendered inside it is not addressable from the page. To edit the contents, edit the snippet body itself; every instance updates.

### Locator-aware tools

`add_node`, `update_props`, `apply_classes`, `move_node`, `remove_node`, `inspect`, `instantiate_snippet`, `update_snippet_args`, `apply_classes_bulk`, `update_props_bulk`, `set_node_id` — every `path`/`parentPath`/`fromPath`/`toParent` field accepts either a path array or an `@id` string.

| Tool | Args | Notes |
|---|---|---|
| `set_node_id` | `pageId, variantId, path, id` | Assign / rename / clear (`id: null`) a node's stable anchor. Targets `ComponentNode` and `SnippetInstance` — param refs can't carry ids |

## Error model

Errors are discriminated unions with a `kind` field. Every mutation returns `Result<T, MutationError>`; routes map error variants to HTTP status codes and the MCP layer returns them as structured tool errors.

| `kind` | Meaning |
|---|---|
| `PageNotFound` | The named page doesn't exist |
| `VariantNotFound` | The named variant doesn't exist on the page |
| `UnknownComponent` | `componentRef` not in the active palette; carries `suggestions[]` by Levenshtein distance |
| `InvalidPath` | Path doesn't resolve in the variant tree |
| `InvalidMove` | `move_node` would create a cycle or move into self |
| `LastPage` | `remove_page` refuses when only one page is left |
| `LastVariant` | `remove_variant` refuses when only one variant is left on a page |
| `VariantIdConflict` | `add_variant` id collides with an existing variant |
| `PageIdExhausted` | Couldn't derive a unique page id from the supplied name |
| `BadRequest` | Zod validation failed at the route boundary; carries the issue list |
| `SnippetNotFound` | The named snippet doesn't exist |
| `SnippetParamMismatch` | `args` to `instantiate_snippet` don't match the declared `params` (missing required, unknown extras, type mismatch) |
| `SnippetCycle` | Snippet body would reference itself (directly or transitively) |
| `SnippetInUse` | `remove_snippet` refuses when pages still instantiate it; carries the referencing `pageIds[]` |
| `SnippetIdConflict` | `add_snippet` id collides with an existing snippet |
| `IdNotFound` | An `@id` locator didn't resolve to any node in the variant; carries `id` |
| `IdConflict` | Two nodes in the same variant share an `$id`; carries `id` + `paths[]` |

## Initialize handshake

Server returns the standard MCP `initialize` response with concrete agent nudges in `instructions`. The text below is the working version; treat the exact wording as fluid.

> You are working on a Velloo design folder. Components come from a pinned shadcn snapshot. Designs are static — click handlers, routing, and forms are no-op.
>
> **Before composing pages**, call `list_components` (use `mode: "summary"` first — the full schema is large) and `get_theme` to understand the available palette and active tokens.
>
> **Prefer semantic theme tokens** (`bg-card`, `text-foreground`, `bg-primary`, `bg-muted`, `border-border`) over raw Tailwind colors (`bg-zinc-900`, `text-white`) so designs auto-adapt to dark mode and theme changes.
>
> **Use `add_node`'s `children` parameter** to add whole subtrees in one call — every child can be a full node (with its own props + children). One call beats N round-trips.
>
> **Prefer snippets for repeated structure** (feature cards, list items, hero sections). Create the snippet once with `add_snippet`, then call `instantiate_snippet` per occurrence. Edits to the body propagate; arg lists keep instances different. Snippets emit as real React components on `emit_code`.
>
> **New pages get one variant** at the requested viewport. Use `add_variant` (or `add_variant({ fromVariantId })` to clone) for additional viewports.
>
> **Text content** for `Heading`, `Text`, `Button`, `Badge`, `Label` goes in the `children` prop, not a `text` prop.
>
> **`Icon` takes any lucide-react name** as its `name` prop (e.g. `Sparkles`, `ArrowRight`, `Check`). The list is huge; pick by feel.
>
> **`screenshot`** is available — use it to verify layout when something feels off rather than guessing.
