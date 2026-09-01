# MCP Surface

> Velloo's MCP tool surface for AI agents. Token-efficient by construction.

Designed for token efficiency: every tool is scoped, typed, and operates on small JSON. Compared to Penpot's `execute_code` (raw JS over the entire Plugin API) or Paper's `write_html` (HTML literals), each operation here is a single structural mutation with predictable cost.

A typical screen is 30–80 nodes, ~2–4 KB of JSON. The agent can `get_screen`, plan multiple ops, and apply them in a tight loop with low token spend per turn.

## Tool surface

### Progressive disclosure (opt-in)

**The default surface is flat — every tool advertised up front.** Progressive disclosure is opt-in via `VELLOO_MCP_PROGRESSIVE=1`: the server then advertises a lean **core** surface (the compose→verify→emit loop) and hides long-tail tool *families* until the agent asks for them, so fewer schemas sit in context and there are fewer ways to mis-select. A hidden tool is absent from `tools/list` and rejects calls.

Flat is the default because it requires a client that re-fetches the tool list on `tools/list_changed` — and major agent clients (Claude Code among them) index tools once at connect and never refresh, which leaves revealed tools permanently uncallable (2026-07 gallery dogfood: every agent hit this). `VELLOO_MCP_FLAT=1` still force-flattens and wins if both vars are set.

| Tool | Args | Notes |
|---|---|---|
| `reveal_tools` | `area: "theme-authoring" \| "lifecycle" \| "annotations-write" \| "all"` | Progressive mode only. Unlock a hidden family. Fires `tools/list_changed` (compliant clients re-fetch the larger list automatically) and returns the now-callable tool names + that family's guidance. Idempotent |

Hidden families (progressive mode): **theme-authoring** (`add_theme`, `apply_preset`, `score_theme_contrast`, `list_themes`), **lifecycle** (the `remove_*` for boards/frames/groups/screens/snippets/extensions + `update_board`/`update_group`/`update_screen`/`update_extension`), **annotations-write** (`add_annotation`, `remove_annotation`). Everything else — including reads (`list_annotations`), node deletes (`remove_node`), frame edits (`update_frame`), `import_theme`, and `derive_palette_from_color` — stays core.

### Discovery

| Tool | Args | Returns |
|---|---|---|
| `list_screens` | `include_tree?: boolean` | `[{ id, name, tree? }]`. Pass `include_tree: true` for a single-round-trip overview of every screen |
| `get_screen` | `screenId, mode?: "full" \| "outline"` | full screen JSON, or a stripped `{ref/snippet, $id, classSnippet (≤40 chars), children}` tree when `mode: "outline"` for scanning long screens |
| `list_boards` | `include_frames?: boolean` | `[{ id, name, frameCount, frames?, groups? }]` — pass `include_frames: true` to embed each board's full frame list in one round-trip |
| `get_board` | `boardId` | `{ id, name, frames: [...], groups: [...] }` — frame placement on the named board |
| `list_components` | `filter?, mode?: "summary" \| "full"` | `[{ id, props, category, summary }]` — summary mode returns just `{ id, props (names only), category, source }` to avoid blowing the token cap on first call |
| `install_component` | `componentId, screenId?` | The existing-project flow's "is this component available + install it if not." Resolves the active library's catalog: an already-present component (every shipped library bundles its whole set, so the common case) returns `{ installed: true, importPath }` — just `$ref` it; an uninstalled one routes to the adapter's installer (shadcn-upstream's per-component fetch); an unknown id errors with the catalog. `screenId` picks the library; omitted ⇒ folder default |
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
| `set_style` | `screenId, path, style` — style a node through the screen's framework-native **`StyleChannel`**: a Tailwind `className` string for shadcn, an `sx` object for MUI, and for no-framework either (folder's `config.styling`) — a Tailwind `className` string (`none/tailwind`) or a plain inline `style` object (`none/none`, themed via `var(--…)` tokens, no JIT). Object channels merge shallowly (inner `null` drops a key); `style: null` clears. A payload shape that doesn't fit the channel is rejected with the expected shape (how the agent discovers the channel). On a className channel, equivalent to setting `className` via `update_props` |
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
| `remove_screen` | `screenId` | Refuses to remove the last screen (`LastScreen`). Frames referencing the screen are removed too — **cascaded** across every board and returned as `removedFrames: [{ boardId, frameIds[] }]`; undoable via `/api/undo` (canvas ⌘Z) |

### Board lifecycle

Boards are the canvases of a design folder; one folder has many. Each board owns its own frames + groups and persists as `boards/<id>.json`.

| Tool | Args | Notes |
|---|---|---|
| `add_board` | `name, id?` | Create a new empty board. Id is derived from `name` if omitted |
| `update_board` | `boardId, patch` | Sparse patch on `name` (only field today) |
| `remove_board` | `boardId` | Refuses to remove the last board (returns `LastBoard`). Undoable |
| `reorder_boards` | `order` | Set the sidebar board order (board ids). Unknown ids dropped, omitted boards appended. Persists to `config.boardOrder`; the canvas drag-and-drop calls this |

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
| `import_assets` | `paths: string[], baseDir?, overwrite?` — bulk-import existing image/SVG files into `assets/` BY PATH (no base64). Globs (`../gen/*.png`) expand relative to `baseDir` (default: server cwd). Max 5MB each; missing/oversized/non-image entries are reported per-entry, never failing the batch |
| `generate_asset` | `prompt, intent, aspect?, count?, reference?, filename?` — hosted, **pay-as-you-go** generation via velloo-cloud (requires `velloo login`). `intent` says what the art is FOR and the server picks the model: `photo`, `illustration`, `graphic` (legible text), `texture`, `icon`, `vector` (true SVG), `mark` (geometric SVG, cheapest), `edit`, `cutout`, `upscale`. `count` 1–4 returns variants (**each charged**, stored as `<stem>-1`, `<stem>-2`, …). `reference` takes folder asset paths — required by `edit`/`cutout`/`upscale`, optional style guidance for the text-to-image intents. Decodes results into `assets/` (same store + naming as `upload_asset`) and returns each `/assets/<name>` URL; SVG intents also return inline markup for `<SVG content>`. The result reports the exact cost + remaining balance — relay both. Failures (logged out, out of credits, rate-limited, generation disabled) come back as clear messages naming the free local alternative |
| `batch` | `calls: [{ tool, args }], atomic?` — multi-mutation envelope. Atomic by default: first error rolls back every touched resource (disk + memory + undo history) and reports `rolledBack: true`. `atomic: false` keeps completed work |

### Extensions

Extensions register wholly new components the active library doesn't have — the app's custom `DataTable`, a brand `Hero`, a bespoke chart. Folder-global; a same-id extension shadows the library component. `add_extension` is core; `update_extension` / `remove_extension` live in the `lifecycle` hidden family.

| Tool | Args | Notes |
|---|---|---|
| `add_extension` | `id, importPath, props, category?, description?, render?, fit?` | Registers the component: placeholder card on the canvas, real `import` from `importPath` on `emit_code`. `render: "live"` bundles the actual host component and client-mounts it for a pixel-faithful preview (charts above all); `fit` sizes the live island (`aspect-video` default, `content` for self-sizing) |
| `update_extension` | `id, patch: { importPath?, props?, category?, description?, render?, fit? }` | Sparse patch — add/remove props, retarget importPath, flip render mode. Renaming is deliberate remove+add (a rename would break tree references) |
| `remove_extension` | `id` | Refuses while any screen/snippet tree still references it (`ExtensionInUse`, carrying the offending nodes) — remove or re-`$ref` those first, then retry |

### Frame / group lifecycle

Frames are placements of screens on a chosen board. Multiple frames of the same screen always render the same tree at different sizes — that's the sync model.

| Tool | Args | Notes |
|---|---|---|
| `add_frame` | `boardId, screenId, x?, y?, w, h, label?, group?, id?` | Drop a frame for a screen at a given size + position on a specific board. Position defaults to a free spot on the board if `x`/`y` omitted |
| `update_frame` | `boardId, frameId, patch` **or** `boardId, patches: [{ frameId, patch }]` | Sparse patch: `x`, `y`, `w`, `h`, `label`, `group` (pass `null` to clear label/group). Single-or-bulk like `update_props`: pass `patches` to lay out many frames in one atomic write (single persist, broadcast, undo entry) |
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
| `compare_to_url` | `screenId, url? \| captureId?, w?, h?, mode?, fullPage?, scale?, theme?, image?, settleTimeoutMs?, storageStatePath?, cookies?, localStorage?, fitFrames?` | Code-to-design fidelity check: render the screen and screenshot a live URL (the app page being ported) at the same viewport, then pixel-diff. Returns `{ similarity, changedRatio, heightDelta, regions }` with each region mapped to the screen node under it, plus a side-by-side PNG (URL left, Velloo right; `image: false` for metrics only). `scale` defaults 0.5. `mode: "dark"` renders the Velloo side dark **and** best-effort drives the target page dark (prefers-color-scheme + `.dark`/`data-theme` on `<html>` + `localStorage.theme`) so dark fidelity checks against the app's real dark theme. `settleTimeoutMs` (default 8000) caps the network-quiet wait before capture — raise it for data-heavy pages that paint a spinner first. `storageStatePath`/`cookies`/`localStorage` inject an authenticated session past login walls. `fitFrames: true` resizes any board frame that clips this screen up to its content height (returns `fittedFrames`). Exactly one of `url` / `captureId`: `captureId` diffs against a **stored browser capture** instead of fetching, which is how an auth-gated page gets verified — the capture is already past the login and frozen, so it can't drift or bounce to a login wall between calls (the durable form of `cacheUrl`). Capture PNGs are taken at the display's device pixel ratio and reconciled automatically; `scale` snaps to 1/0.5/0.25 in that mode |

### Browser capture

A human-driven browser session that turns a page velloo can't otherwise reach — behind a login, on staging, on a third-party site — into local evidence for the agent. The session is driven by the **user** from an in-page toolbar; the agent starts it and reads what comes back.

| Tool | Args | Returns |
|---|---|---|
| `start_capture_session` | `url?` | Opens a real browser window the user drives, and **returns immediately** with `{ sessionId }` — it does not wait for the session (a call held open for the length of a login would sit on the MCP connection long enough to trip the proxy). Poll `list_captures` for captures as the user makes them. Opening it emits an activity event and a daemon console notice, so an agent-started session is visible as one |
| `list_captures` | — | Stored captures for this folder, newest first: `captureId`, url, title, `capturedAt`, viewport, `themeOnly`, node/asset counts |
| `get_capture` | `captureId, full?` | The evidence: a structural `outline` of the page with **repeated blocks marked** (component candidates), `themeCss` — the page's CSS custom properties as `import_theme`-ready CSS, including any `.dark` block — `fonts`, and downloaded image `assets`. `full: true` returns every extracted node with computed styles. Never returns session cookies |

Captures are stored **outside the design folder** (under `~/.velloo/captures/<folder>/`) and served by the daemon at `/api/captures/…`, which is also how the canvas lists and deletes them. The session credential is scoped to the registrable domain of the captured origins — so a sibling auth subdomain is kept and third-party SSO cookies are dropped — written `0600`, and expired after 14 days.

The loop for an authenticated app: `start_capture_session` → user logs in and captures → `get_capture` → `import_theme` with its `themeCss` → re-express the page with real components (**do not transcribe the DOM**) → `compare_to_url { captureId }`.

### Codegen and export

| Tool | Args |
|---|---|
| `emit_code` | `screenId, componentsAlias?` — returns a structured JSX-shaped intermediate representation intended for the agent to read and transform into the user's app code (using their conventions, routing, providers). Emits the screen framework's native idiom: shadcn → library ids + Tailwind classes; MUI → `<Component sx={{…}} />` importing from `@mui/material`. `componentsAlias` overrides the per-folder default. **Not paste-ready output.** |
| `emit_snippet` | `snippetId, componentsAlias?` — same idea, scoped to a single snippet. Returns PascalCase component name, typed params, JSX body |
| `emit_theme` | `outputDir, apply?: boolean, cssOnly?: boolean, themePath?` — emits the active framework's theme artifact: shadcn → Tailwind v4 `globals.css` (+ optional `tailwind.config.ts`); MUI → a `createTheme(...)` module at `themePath` (default `theme.ts`). Defaults to dry-run; set `apply: true` to write. Direct user-facing artifact; agent does not need to transform it |

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
| `ScreenInUse` | The strict removal variant (`removeScreenStrict`, HTTP layer) refuses when frames reference the screen; carries `usage: { boardId, frameIds[] }[]`. The MCP `remove_screen` tool cascades instead and never returns this |
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
- **Use `add_node`'s `children` array** to land whole subtrees in one call. The bulk forms (`update_props` / `update_frame` with `patches`) collapse N round-trips into one persist + one undo entry; `batch` covers multi-tool sequences atomically.
- **Use `@id` locators** for anchors you reference more than once. Pass `id: "hero-cta"` to `add_node` / `instantiate_snippet`, or call `set_node_id` to retroactively name a node. Ids survive sibling insertions.
- **Snippet instances are opaque.** Design for variation up-front: boolean params + `$if`, `enum` params for full-className swaps, `node` params for slot composition, `extraClassName` for one-off per-instance tweaks.
- **Always call `render_snippet` after `add_snippet`** — `$param` wiring bugs and `$if` truthy-coercion mistakes are silent at definition time and only surface at instantiation.
- **One tree per screen.** Viewport size is a property of each `frame` placement. Different viewport renderings of the same screen → multiple frames pointing at the same screen (edits sync). Different layouts per breakpoint → separate screens with their own frames.
- **`screenshot mode: "compare"`** renders light + dark side-by-side in one PNG — the fastest signal that the design actually adapts.
- **Annotations are guidance.** `list_annotations(screenId)` returns markdown notes the designer attached to specific nodes. Each annotation carries a `resolved` path (null when the targeted node has been removed — low-priority, the note is stale). Read-only.

## Format gate (folder needs migration)

When the design folder's on-disk format doesn't match the binary (`schemaVersion` in `.design/config.json` vs `CURRENT_SCHEMA_VERSION`), the canvas daemon refuses to boot — so `velloo mcp` (stdio) serves a **degraded gate session** instead of dying, because the spawning agent can't read a dead process's stderr. Implementation: `packages/server/src/mcp/format-gate.ts`, wired in `packages/cli/src/commands/mcp.ts`.

- `initialize` succeeds; `instructions` explain the mismatch and how to resolve it.
- Folder **older** than the binary: one tool is advertised, `upgrade_design_folder`, which runs the same migration as `velloo upgrade` (stops any daemon, rewrites, validates). Its result tells the agent to reconnect the MCP server to load the real design tools.
- Folder **newer** than the binary: no tool — the instructions say the velloo CLI itself must be updated, then reconnect.

The same version check runs *before* any daemon spawn (`assertFolderFormatCurrent` in `packages/cli/src/daemon/runtime.ts`), so `velloo run` fails immediately with the `velloo upgrade` hint instead of waiting out the daemon health timeout.
