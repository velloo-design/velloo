# MCP Surface

> Velloo's MCP tool surface for AI agents. Token-efficient by construction.

Designed for token efficiency: every tool is scoped, typed, and operates on small JSON. Compared to Penpot's `execute_code` (raw JS over the entire Plugin API) or Paper's `write_html` (HTML literals), each operation here is a single structural mutation with predictable cost.

A typical design page is 30–80 nodes, ~2–4 KB of JSON. The agent can `get_variant`, plan multiple ops, and apply them in a tight loop with low token spend per turn.

## Tool surface

### Discovery

| Tool | Args | Returns |
|---|---|---|
| `list_pages` | — | `[{ id, name, variants: [{ id, name, viewport }] }]` |
| `get_page` | `pageId` | full page JSON |
| `get_variant` | `pageId, variantId` | single variant tree |
| `list_components` | `filter?, mode?: "summary" \| "full"` | `[{ id, props, category, summary }]` — summary mode returns just `{ id, summary, category }` to avoid blowing the token cap on first call |
| `list_snippets` | — | `[{ id, name, params }]` |
| `get_snippet` | `snippetId` | full snippet JSON (`{ id, name, params, tree }`) |
| `get_theme` | — | full token tree |

### Tree mutations

| Tool | Args |
|---|---|
| `add_node` | `pageId, variantId, parentPath, componentRef, props?, children?, index?` — `children` accepts full subtrees so an agent can build a feature card in one call |
| `update_props` | `pageId, variantId, path, propPatch` |
| `move_node` | `pageId, variantId, fromPath, toParent, toIndex?` |
| `remove_node` | `pageId, variantId, path` |
| `inspect` | `pageId, variantId, path` — returns rendered DOM + computed styles |
| `apply_classes` | `pageId, variantId, path, classes` — Tailwind class edit on a node |
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
| `instantiate_snippet` | `pageId, variantId, parentPath, snippetId, args, index?` | Adds a `$snippet` node — opaque from outside, internal paths are not addressable |
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
| `screenshot` | `pageId, variantId, mode?: "light" \| "dark"` | Base64 PNG via Playwright. Agents finally get to see what they built |

### Codegen and export

| Tool | Args |
|---|---|
| `emit_code` | `pageId, outputPath` — writes idiomatic shadcn JSX |
| `emit_theme` | `outputPath` — writes `tailwind.config.ts` + `globals.css` (diff mode) |

## Path addressing

Nodes are addressed by integer path arrays from the variant root: `[0, 2, 1]` = first child, third grandchild, second great-grandchild. Cheaper to serialize than string selectors and unambiguous for the agent.

Edits return the new path of the affected node so the agent can chain operations without a re-read.

**Snippet instances are opaque.** A `$snippet` node has a path, but the structure rendered inside it is not addressable from the page. To edit the contents, edit the snippet body itself; every instance updates.

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
