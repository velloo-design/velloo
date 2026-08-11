# MCP Surface

> Velloo's MCP tool surface for AI agents. Token-efficient by construction.

Designed for token efficiency: every tool is scoped, typed, and operates on small JSON. Compared to Penpot's `execute_code` (raw JS over the entire Plugin API) or Paper's `write_html` (HTML literals), each operation here is a single structural mutation with predictable cost.

A typical design page is 30–80 nodes, ~2–4 KB of JSON. The agent can `get_variant`, plan multiple ops, and apply them in a tight loop with low token spend per turn.

## V0 tool surface

### Discovery

| Tool | Args | Returns |
|---|---|---|
| `list_pages` | — | `[{ id, name, variants: [{ id, name, viewport }] }]` |
| `get_page` | `pageId` | full page JSON |
| `get_variant` | `pageId, variantId` | single variant tree |
| `list_components` | `filter?` | `[{ id, props: TSSchema, category, designModeNotes? }]` |
| `get_theme` | — | full token tree |

### Tree mutations

| Tool | Args |
|---|---|
| `add_node` | `pageId, variantId, parentPath, componentRef, props?, children?` |
| `update_props` | `pageId, variantId, path, propPatch` |
| `move_node` | `pageId, variantId, fromPath, toPath` |
| `remove_node` | `pageId, variantId, path` |
| `add_variant` | `pageId, fromVariantId?, viewport, name` — optionally clones an existing variant |
| `inspect` | `pageId, variantId, path` — returns rendered DOM + computed styles |
| `apply_classes` | `pageId, variantId, path, classes` — Tailwind class edit on a node |

### Theme operations

| Tool | Args | Notes |
|---|---|---|
| `set_token` | `path, value` | Mutates one token |
| `apply_preset` | `presetName` | Switches entire theme |
| `derive_palette_from_color` | `seedColor, name?` | Generates accessible scale via OKLCH |
| `match_vibe` | `description` | Agent-driven theme synthesis (e.g. "playful, energetic, mid-saturation") |
| `match_image` | `imagePath` | Extracts palette from an image |

### Codegen and export

| Tool | Args |
|---|---|
| `emit_code` | `pageId, outputPath` — writes idiomatic shadcn JSX |
| `emit_theme` | `outputPath` — writes `tailwind.config.ts` + `globals.css` (diff mode) |

## Path addressing

Nodes are addressed by integer path arrays from the variant root: `[0, 2, 1]` = first child, third grandchild, second great-grandchild. Cheaper to serialize than string selectors and unambiguous for the agent.

Edits return the new path of the affected node so the agent can chain operations without a re-read.

## Error model

| Code | Meaning |
|---|---|
| `INVALID_PATH` | path doesn't exist in the variant tree |
| `UNKNOWN_COMPONENT` | `componentRef` not in the active palette |
| `INVALID_PROPS` | props don't match the component's TS schema |
| `LOCKED_VERSION_MISMATCH` | design's locked tool/shadcn version differs from running tool |
| `RENDER_ERROR` | component placed but failed to render in canvas (e.g. missing required provider) |

Errors include suggestions where possible (e.g. `INVALID_PROPS` returns the schema; `UNKNOWN_COMPONENT` returns the closest matches by Levenshtein).

## Cut from V0 (deferred)

| Tool | Why deferred |
|---|---|
| `screenshot` | Agent works blind via `inspect`. Real screenshots come once canvas rendering is stable enough for headless reliability. |
| `create_snippet` / `update_snippet` / `instantiate_snippet` | Snippets cut from V0; doubled MCP surface and complicated codegen. |
| `add_source` | Plugin or component-source installation. V1+. |
| `validate_design` | Drift checker between design and running shadcn version. Add when upgrade flow has real users. |

## Initialize handshake

Server returns the standard MCP `initialize` response with one extra hint in `instructions`:

> You are working on a design folder. Components come from a pinned shadcn snapshot. Designs are static — click handlers, routing, and forms are no-op. Before composing pages, call `list_components` and `get_theme` to understand the available palette and active tokens.
