# MCP Surface

> Velloo's MCP tool surface for AI agents. Token-efficient by construction.

Designed for token efficiency: every tool is scoped, typed, and operates on small JSON. Compared to Penpot's `execute_code` (raw JS over the entire Plugin API) or Paper's `write_html` (HTML literals), each operation here is a single structural mutation with predictable cost.

A typical screen is 30–80 nodes, ~2–4 KB of JSON. The agent can `get_screen`, plan multiple ops, and apply them in a tight loop with low token spend per turn.

## Tool surface

### The context budget

Velloo uses **server-selected progressive disclosure at initialization**. It does not use a `reveal_tools` tool or `tools/list_changed`: major agent clients index tools once at connect, so disclosure that needs the model or client to refresh the list is unreliable.

The session selects one immutable surface before the MCP handshake:

- **`guided` (default):** three stable tools — `call_velloo`, `run_velloo_plan`, and `operation_schema`. Calls dispatch to the exact native handler and schema; a validation or native failure returns the correction schema inline.
- **`full`:** every native tool is advertised directly, for clients and models that do better with conventional function schemas, and as the quality-control baseline.

Select with `velloo mcp --surface <mode>`. HTTP sessions carry the selection in the MCP URL query; stdio also accepts `VELLOO_MCP_SURFACE`.

**Both surfaces carry the whole catalogue, and that is deliberate.** An earlier iteration added four workflow profiles (`code-to-design`, `three-variants`, `local-comments`, `design-to-code`) that narrowed the operation set before the handshake. They were removed: a pre-session allow-list is a guess about which verbs a workflow needs, and three of the four guessed wrong against their own recipes — `code-to-design` forbade the `add_board` the bare-folder setup order calls for, `design-to-code` forbade the `compare_to_url` its recipe ended on, `local-comments` could not `remove_node` to honour "delete this button". Because the surface is immutable for the session, a blocked agent had no way back, and the open-comment-thread notice pointed at tools three of the four profiles had removed. Workflow steering belongs in a skill or a `velloo://guide/*` resource, where it can shape behaviour without amputating capability. A stale `surface=profile` URL or `profile=` query param still parses (mapped to `full`, and ignored, respectively) rather than failing the handshake.

What holds the remaining budget:

1. **Tool descriptions say WHAT and WHEN, in one or two sentences**, and name their guide. They do not carry manuals, and they do not restate what a field's own `.describe()`, an enum, or a guide already says. The check that keeps them honest: cut a sentence and ask what call an agent would now get wrong.
2. **Long-form guidance is an MCP resource** — `velloo://guide/{components,snippets,theme,boards,verification,porting,capture,extensions,art,comments}` — fetched on demand, so a session that never ports an app never pays for the porting manual.
3. **The guided boot instructions carry only the dispatch contract and selected recipe.** Full sessions retain the complete mental model for compatibility.

`bun packages/server/scripts/mcp-token-budget.ts` measures guided and full (instructions + wire schemas + the resource listing) and checks both budgets. Adding a paragraph to the instructions taxes every session forever — check whether it belongs in a guide or a tool description first.

### Shape rules

The surface holds itself to four rules. Each replaced a contract that used to live in prose or a runtime check:

1. **One name per field.** `props`/`propPatch` were the same field under two names, aliased in both directions, so neither was canonical. `add_node` takes `props` (it sets initial props); `update_props` takes `propPatch` (it patches).
2. **No dual forms.** `update_props` and `update_frame` take `patches` only — a length-1 array is the single-node case. The old single-or-bulk pair declared five optional fields where two combinations were legal, and rejected the rest at runtime with prose. `screenshot`/`compare_to_url` likewise take a `viewport` object, not a flat `w`/`h` that silently outranked it.
3. **Every `*Body` is a `z.strictObject`.** An undeclared argument fails loudly with the valid keys on every surface. This used to differ: MCP rewrapped shapes as strict at registration while `batch` and the HTTP routes parsed a lenient `z.object`, so the same typo was a hard error standalone and a silent no-op inside a batch.
4. **camelCase parameters, `list`/`get`/`add`/`update`/`remove` verbs, one noun per resource.** Every list returns `{ <resource>: [...] }`, never a bare array; every get returns the resource unwrapped.
5. **Mutual exclusion is structural, not prose.** `compare_to_url`'s `source` is a union of a live-URL branch and a stored-capture branch, with auth, settling and caching nested inside the URL branch — those four are meaningless against a capture, which arrives already authenticated and frozen.

7. **A schema states what an agent must choose, not what it must know.** The two are not the same, and conflating them is expensive. `batch` advertises its tool set as an enum but leaves `args` loose: a discriminated union over the real bodies was built and measured at **+3,800 boot tokens**, 19% of the surface, to restate eighteen schemas `tools/list` already carries — and it bought no correctness, since `runBatch` validates every entry against the same body and reports which tool and which field. The same test applies to tolerances: a locator accepts `"[0,2]"` at runtime but does not advertise it, because no agent should choose that spelling.
6. **One error shape, and every failure uses it.** A failure is `isError` plus a JSON `{ kind, … }` — never prose, never an `{ ok: false }` body that an agent reads as success. `mcp/__tests__/tool-policy.test.ts` sweeps the surface for it. (A JSON-RPC `-32602` from the SDK's own argument validation is a protocol error, not a tool result, and is outside this rule.)

### Annotations and output schemas

Every registered tool carries MCP behavioural annotations, classified in one table — `mcp/tool-policy.ts` — and applied by patching `registerTool` once, before any tool registers (the same hook that rewraps input shapes as strict). ~26 tools are pure reads, so a host can auto-approve them and prompt only on writes. The table states only what differs from the MCP defaults (`readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`, `openWorldHint: true`) — an omitted hint is not a missing hint, and every byte is paid by every session. `tool-policy.test.ts` fails in both directions: a registered tool with no classification, and a classification for a tool that no longer exists.

`outputSchema` (plus `structuredContent`) is declared only by the five tools an agent reads as *data* rather than as confirmation: `audit`, `find_nodes`, `list_components`, `emit_code`, `compare_to_url`. Each schema is a `looseObject`, since the SDK validates `structuredContent` and an unexpected field must never turn a good result into a protocol error. The bar for adding one is that the tool's description gets *shorter* because the schema now says it. `screenshot` deliberately has none: its result is a five-way union (baseline established / no visual change / cropped diff / full diff / plain capture) whose branches share almost nothing.

### Resources

| URI | Carries |
|---|---|
| `velloo://guide/components` | Box vs Card, children arrays vs the children prop, inline runs, icons, raw CSS |
| `velloo://guide/snippets` | Params, node slots, `$if`, structural variance, the edit recipes |
| `velloo://guide/theme` | Tokens, presets, fonts, the type ladder, importing an app's stylesheet |
| `velloo://guide/boards` | Frames vs viewports, sidebar groups, archived boards, board-pinned themes |
| `velloo://guide/verification` | screenshot modes, diffing, audit, inspect |
| `velloo://guide/porting` | Code-to-design: re-expressing an app, fidelity checking, known gaps |
| `velloo://guide/capture` | Reaching pages behind a login |
| `velloo://guide/extensions` | Registering the app's own components, live islands |
| `velloo://guide/art` | Authoring assets vs paying to generate them |
| `velloo://guide/comments` | Working the user's visual feedback threads |

### Discovery

| Tool | Args | Returns |
|---|---|---|
| `list_screens` | `includeTree?: boolean` | `{ screens: [{ id, name, tree? }] }`. Pass `includeTree: true` for a single-round-trip overview of every screen |
| `get_screen` | `screenId, mode?: "full" \| "outline"` | full screen JSON, or a stripped `{ref/snippet, $id, classSnippet (≤40 chars), children}` tree when `mode: "outline"` for scanning long screens |
| `list_boards` | `includeFrames?, includeArchived?` | `{ boards: [{ id, name, frameCount, group?, frames?, groups?, archivedAt? }] }` — `group` names the sidebar group the board is filed under (absent ⇒ ungrouped); `includeFrames` embeds each board's full frame list, `includeArchived` also lists boards the user archived |
| `get_board` | `boardId` | `{ id, name, frames: [...], groups: [...] }` — frame placement on the named board |
| `component_status` | `ids?, screen?, library?` | Compile-checks components for the browser mount: `{ library, usable, diagnostics: [{ id, status: exact \| adapted \| fallback \| unavailable \| unknown, importPath?, note?, errors? }], errors }`. With `screen`, checks exactly that screen's refs and returns `mounted` — one `unavailable` component keeps the whole screen on the server render, which a per-id call cannot show |
| `list_components` | `filter?, mode?: "index" \| "summary" \| "full", kind?, unusedOnly?` | Index mode (default) returns `{ snapshotVersion, groups: [{ group, label, families: [{ id, pieces?, designModeNotes? }] }], totals, unavailableInDesign?, notInstalledInApp? }`; summary and full modes return `{ snapshotVersion, components: [...] }`, summary carrying prop names only. `kind` narrows to library, extension or snippet. A snippet no screen reaches (directly or through another snippet) is flagged `unused`; `unusedOnly` lists only those |
| `install_component` | `componentId, screenId?` | The existing-project flow's "is this component available + install it if not." Resolves the active library's catalog: an already-present component (every shipped library bundles its whole set, so the common case) returns `{ installed: true, importPath }` — just `$ref` it; an uninstalled one routes to the adapter's installer (shadcn-upstream's per-component fetch); an unknown id errors with the catalog. `screenId` picks the library; omitted ⇒ folder default |
| `list_snippets` | — | `[{ id, name, params }]` |
| `get_snippet` | `snippetId` | full snippet JSON (`{ id, name, params, tree }`) |
| `get_theme` | — | full token tree |
| `list_annotations` | `screenId` | Designer-authored markdown annotations on a screen. Each carries a `target: { locator }` and a `resolved` path (null when the targeted node has been removed — treat as low-priority). Read-only: agents can act on annotations but not create or edit them |
| `list_notes` | `boardId` | Board markdown notes, free-positioned or attached to a node (`attachment`). Writable via `add_note` / `update_note` / `remove_note` |
| `find_nodes` | `screenId, ref?, snippetId?, id?, classContains?, prop?, propValue?, limit?` | Query a screen tree for matching nodes (filters AND together). Returns `{ matches: [{ path, kind, ref, id?, className?, textPreview?, childCount }], total }` — locate targets for path-accepting tools without fetching and walking the whole tree |

### Tree mutations

A screen has one tree. Path-accepting tools target nodes within that screen's tree.

| Tool | Args |
|---|---|
| `add_node` | `screenId, parentPath, componentRef, id?, props?, children?, index?` — `children` accepts full subtrees so an agent can build a feature card in one call. Pass `id` for a stable `@id` anchor |
| `update_props` | `screenId, patches: [{ path, propPatch?, style? }]` — one entry per node, applied in one atomic write (one lock, one broadcast); length 1 for a single edit. `propPatch` shallow-merges props (null removes a key); `style` is the framework-native **`StyleChannel`** — a Tailwind `className` string for shadcn, an `sx` object for MUI, an inline `style` object for none/none. Object channels merge shallowly (an inner `null` drops that key); `style: null` clears. An entry may carry either or both; one that carries neither is rejected |
| `update_snippet_instance` | `screenId, path, argPatch?, extraClassName?, innerPath?, propPatch?` — edit ONE snippet instance from either side: `argPatch`/`extraClassName` change what the caller passes in, `innerPath`+`propPatch` patch a node inside just this instance's body (innerPath = `"@id"` of a body node (preferred), a dotted index path, or `""` for the body root). Both compose in one call. `emit_code` inlines an overridden instance |
| `move_node` | `screenId, fromPath, toParent, toIndex?` |
| `remove_node` | `screenId, path` |
| `inspect` | `screenId, path, innerPath?, computed?, viewport?, mode?, theme?` — returns SSR'd HTML, resolved className list, `$ref`, and resolved props for the node. When `path` resolves to a snippet instance the body is rendered with its args / `$overrides` / `$extraClassName` applied; `innerPath` (`"@id"`, dotted index, or "" for the body root — the same scheme as `update_snippet_instance`) drills into one body node. Omitting `innerPath` on an instance inspects the body root and returns a `note` on how to drill in. `computed: true` additionally renders the screen in a real browser and returns the node's resolved box and computed styles plus its direct children's boxes (`{ rect, style, tag, class, children }`) — what the node rendered *as*, rather than what its classes said it should. It costs a render, so it is opt-in; a node inside a snippet body isn't separately addressable in the render and returns `computed: null` with a note saying so |
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

Boards are filed into **sidebar groups** — areas of work ("Side pane", "Account page"). The agent surface is one optional `group` argument: pass an existing group's name or id, or a new name and the group is created (color auto-assigned). There are no group-management tools by design — creating, renaming, recoloring, reordering and deleting groups is canvas work over HTTP (`/api/mutate/add_board_group`, `update_board_group`, `remove_board_group`, `reorder_board_groups`). Groups live in `config.boardGroups`; a board points at one via `Board.group`.

| Tool | Args | Notes |
|---|---|---|
| `add_board` | `name, id?, group?` | Create a new empty board. Id is derived from `name` if omitted; `group` files it (creating the group when the name is new) |
| `update_board` | `boardId, patch` | Sparse patch on `name`, `theme`, `archived`, `group` (`null` ⇒ Ungrouped) |
| `remove_board` | `boardId` | Cascades: screens no other board places go with it (`removedScreenIds`), then snippets those screens were the last to reach (`removedSnippetIds`) — a snippet already unreferenced is left alone. A folder with zero boards is a supported state, so removing the only board is allowed. Undoable |
| `reorder_boards` | `order` | Set the sidebar board order (board ids). Unknown ids dropped, omitted boards appended. Persists to `config.boardOrder`; the canvas drag-and-drop calls this |

### Folder config

Fields in `.design/config.json`. Only the viewport presets have an MCP tool — the rest of the config surface (default board/screen, codegen alias, feedback) is edited from the canvas settings dialog over HTTP (`/api/mutate/update_defaults`, `update_codegen`, `update_feedback`), and read whole from `GET /api/config`. All of them persist through `persistConfig` and broadcast `config-changed`.

| Tool | Args | Notes |
|---|---|---|
| `update_viewport_presets` | `presets` | Replace the folder's frame-size offers wholesale, in display order. Names must be distinct; at least one is required. Frames store their own `w`/`h`, so this never resizes an existing frame |

### Canvas notes

Board notes carrying markdown-lite guidance — tour steps, review remarks, handoff context. A note is either **free**, positioned in board coordinates (the same space as frame `x`/`y`), or **attached** to a node inside a frame, which the canvas anchors with a connector and auto-places beside the frame until the author drags it. Node-anchored *annotations* remain designer-authored; the agent reads those via `list_annotations`.

| Tool | Args |
|---|---|
| `add_note` | `boardId, x?, y?, width?, body, attachment?: { frameId, screenId, locator }` — `x`/`y` required unless an `attachment` is given |
| `update_note` | `boardId, noteId, patch: { x?, y?, width?, body? }` |
| `remove_note` | `boardId, noteId` |
| `add_annotation` | `screenId, path, body, collapsed?` — pin agent-authored markdown to a node (author: "agent") |
| `update_annotation` | `screenId, annotationId, body?, collapsed?` | Edit one of your OWN annotations. Refuses user-authored ones — answer those with your own annotation rather than rewriting theirs |
| `remove_annotation` | `screenId, annotationId` — agent-authored only; user annotations are read-only to agents |

### Assets & batching

| Tool | Args |
|---|---|
| `list_assets` | `unusedOnly?` — what `assets/` already holds: the `/assets/<name>` URL, size, which screens/snippets still reference it, and the originating prompt for anything `generate_asset` produced. Check here before spending on art the folder may already have |
| `upload_asset` | `filename, data (base64), overwrite?` — writes into `assets/`, served at `/assets/<name>`; the agent authors SVG/raster art itself (max 5MB) |
| `import_assets` | `paths: string[], baseDir?, overwrite?` — bulk-import existing image/SVG files into `assets/` BY PATH (no base64). Globs (`../gen/*.png`) expand relative to `baseDir` (default: server cwd). Max 5MB each; missing/oversized/non-image entries are reported per-entry, never failing the batch |
| `generate_asset` | `prompt, intent, aspect?, count?, reference?, filename?` — hosted, **pay-as-you-go** generation via velloo-cloud (requires `velloo login`). `intent` says what the art is FOR and the server picks the model: `photo`, `illustration`, `graphic` (legible text), `texture`, `icon`, `vector` (true SVG), `mark` (geometric SVG, cheapest), `edit`, `cutout`, `upscale`. `count` 1–4 returns variants (**each charged**, stored as `<stem>-1`, `<stem>-2`, …). `reference` takes folder asset paths — required by `edit`/`cutout`/`upscale`, optional style guidance for the text-to-image intents. Decodes results into `assets/` (same store + naming as `upload_asset`) and returns each `/assets/<name>` URL; SVG intents also return inline markup for `<SVG content>`. The result reports the exact cost + remaining balance — relay both. Failures (logged out, out of credits, rate-limited, generation disabled) come back as clear messages naming the free local alternative |
| `batch` | `calls: [{ tool: enum, args }], atomic?` — multi-mutation envelope. The batchable set is an enum in the schema; `args` stays loose and is validated by `runBatch` against the same protocol body the standalone tool uses. Atomic by default: first error rolls back every touched resource (disk + memory + undo history) and reports `rolledBack: true`. `atomic: false` keeps completed work |

### Extensions

Extensions register wholly new components the active library doesn't have — the app's custom `DataTable`, a brand `Hero`, a bespoke chart. Folder-global; a same-id extension shadows the library component. `add_extension` is core; `update_extension` / `remove_extension` live in the `lifecycle` hidden family.

| Tool | Args | Notes |
|---|---|---|
| `add_extension` | `id, importPath, props, category?, description?, render?, fit?` | Registers the component: placeholder card on the canvas, real `import` from `importPath` on `emit_code`. `render: "live"` bundles the actual host component and client-mounts it for a pixel-faithful preview (charts above all); `fit` sizes the live island (`aspect-video` default, `content` for self-sizing) |
| `update_extension` | `id, patch: { importPath?, props?, category?, description?, render?, fit? }` | Sparse patch — add/remove props, retarget importPath, flip render mode. Renaming is deliberate remove+add (a rename would break tree references) |
| `remove_extension` | `id` | Refuses while any screen/snippet tree still references it (`ExtensionInUse`, carrying the offending nodes) — remove or re-`$ref` those first, then retry |

### Frame lifecycle

Frames are placements of screens on a chosen board. Multiple frames of the same screen always render the same tree at different sizes — that's the sync model.

| Tool | Args | Notes |
|---|---|---|
| `add_frame` | `boardId, screenId, x?, y?, w, h, label?, group?, id?` | Drop a frame for a screen at a given size + position on a specific board. Position defaults to a free spot on the board if `x`/`y` omitted |
| `update_frame` | `boardId, patches: [{ frameId, patch }]` | One entry per frame in a single persist + broadcast + undo entry; length 1 for one frame. `label: null` / `group: null` / `scheme: null` clears that field, an omitted field is unchanged. `scheme` pins a frame's render scheme — a review affordance over the screen's one shared tree, not a design variant |
| `remove_frame` | `boardId, frameId` | Removes the frame placement; the underlying screen is untouched |

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
| `update_snippet` | `snippetId, patch` | Sparse patch on `name`, `params`, `tree`, or `innerPatch` (`{ innerPath, propPatch }` — patch one body node's props in place, the definition-level counterpart of `update_snippet_instance`; shared by all instances, no full-tree resend). All screens referencing the snippet rebroadcast |
| `remove_snippet` | `snippetId` | Refuses if any screen instantiates it; returns the referencing screenIds so the agent can clean up first |
| `instantiate_snippet` | `screenId, parentPath, snippetId, args, id?, extraClassName?, overrides?, index?` | Adds a `$snippet` node — opaque from outside. Pass `id` for a stable anchor; `extraClassName` to layer one-off Tailwind classes onto the snippet body's root; `overrides` (`{ "<innerSelector>": { props } }`, same field `update_snippet_instance` patches) to set per-instance interior props — the active nav item, a red badge — at placement, no follow-up call |

### Visual feedback threads

Persistent app state, never repo files. Every open thread is work addressed to the agent.

| Tool | Args | Notes |
|---|---|---|
| `list_comment_threads` | `boardId?, status?, scope?` | Open threads across the folder by default. `scope` separates `local` (pinned by the user in their canvas) from `shared` (left by a reviewer on a published link) |
| `get_comment_thread` | `threadId` | The complete conversation plus its node/board anchor. A stale anchor keeps its saved bounds + fingerprint as context — never silently re-attach it to a different node |
| `update_comment_thread` | `threadId, reply?, status?` | Act on a thread: `reply` posts an agent message, `status` moves it to `resolved` / `open` / `deleted`. Both in one call is the normal close-out (the reply lands before the status moves). `deleted` is permanent — only on the user's explicit ask |

### Theme operations

| Tool | Args | Notes |
|---|---|---|
| `set_theme` | `theme?, tokens?, fonts?, typeset?, customCss?, from?` | One verb for the whole token document; pass any combination of channels. `tokens` patches dot-paths (`colors.primary.DEFAULT`); `fonts` declares roles (each becomes `--font-<role>` + a `font-<role>` utility, `google` loads the family in design mode); `typeset` sets the rhythm (`size`/`leading`/`flow` plus font roles) the whole h1–h6 ladder derives from; `customCss` replaces `theme/custom.css` wholesale (read it back from `get_theme`); `from` reseeds the palette — `{ preset }` for one of the 12 shipped presets, `{ seedColor }` for an OKLCH ramp with contrast auto-adjusted to WCAG AA — and applies BEFORE the other channels, so one call can preset-then-override. The full theme is schema-validated after each patch |
| `add_theme` | `name, from?, overwrite?` — clone a named theme to `theme/<name>.json`; boards pin it via `update_board { patch: { theme } }`, renders/screenshots via their `theme` param |
| `list_themes` | — | named themes + which boards use each |
| `update_theme` | `name, renameTo` | Rename a named theme, repointing every board that pinned it (the response lists them). Token edits go through `set_theme`'s `theme` param |
| `remove_theme` | `name` | Delete a named theme. Refuses while a board still pins it, naming those boards — repoint or unpin first. The default theme cannot be removed |
| `score_theme_contrast` | `mode?` | Score WCAG contrast ratios for the active theme's salient color pairs in both light and dark palettes (each result carries `mode`); pass `mode` to score one. Returns `{ summary, results: [{ label, fg, bg, ratio, tier: "AAA" \| "AA" \| "AAlarge" \| "Fail" }] }`. Use after a derive / preset to confirm accessibility before shipping |
| `import_theme` | `css?` OR `cssPath?`, `theme?`, `apply?` | Code-to-design: seed the theme from a host app's stylesheet. Parses shadcn-convention `:root`/`.dark` custom props (raw HSL triplets or any CSS color) and Tailwind v4 `@theme` `--color-*` vars (var() indirection resolved), plus `--radius` and `--font-*` roles. With a `cssPath`, also ingests the nearby tailwind.config `theme.extend` — brand `colors`→palette, named `spacing`→spacing tokens (so `w-icon-rail`/`h-header` resolve), `boxShadow`→shadows, `fontFamily`→font roles, `keyframes`+`animation`→`--animate-*`. Undeclared slots keep their current values. Dry-run by default — returns `changes: [{ token, from, to }]`; `apply: true` persists |

### Visualization

| Tool | Args | Returns |
|---|---|---|
| `screenshot` | `screenId, viewport?, mode?: "light" \| "dark" \| "compare", fullPage?: boolean, scale?: 0.25–1, path?, theme?, diff?, resetBaseline?` — `path` captures a single node; `theme` renders with a named theme; `diff: true` compares to the previous same-params capture (tiered result: text-only on zero change, highlight crop + changed-node paths on small change, full image on large) | Base64 PNG via Playwright. `compare` renders light + dark side-by-side in one image. Defaults `fullPage: true` so tall screens aren't clipped. `viewport` defaults to the desktop preset; the screen's tree renders responsively at that size. Read-only: it reports `contentHeight` + `framesShorterThanContent`, and `update_frame` resizes them |
| `render_snippet` | `snippetId, args?, extraClassName?, viewport?, mode?, scale?` | Render a snippet in isolation (no host screen) and return a PNG. Defaults to a 480×640 viewport. Useful for iterating on snippet visuals before stamping |
| `compare_to_url` | `screenId, source, viewport?, mode?, fullPage?, scale?, theme?, image?` — `source` is a union: `{ url, auth?: { storageStatePath?, cookies?, localStorage? }, settleTimeoutMs?, cache?: { freeze?, ttlMs?, refresh? } }` or `{ captureId }` | Code-to-design fidelity check: render the screen and screenshot the page at the same viewport, then pixel-diff. Returns `{ similarity, changedRatio, heightDelta, regions, topMismatches }` with each region mapped to the screen node under it, plus a side-by-side PNG (URL left, Velloo right; `image: false` for metrics only). Declares an `outputSchema`. `scale` defaults 0.5. `mode: "dark"` renders the Velloo side dark **and** best-effort drives the target page dark (prefers-color-scheme + `.dark`/`data-theme` on `<html>` + `localStorage.theme`). `settleTimeoutMs` (default 8000) caps the network-quiet wait — raise it for data-heavy pages that paint a spinner first. `cache.freeze` diffs every later call against one frozen capture, for a page whose content drifts. The capture branch is how an auth-gated page gets verified — the capture is already past the login and frozen, so it can't drift or bounce to a login wall (the durable form of `cache.freeze`); auth/settle/cache have no meaning there, which is why the schema doesn't offer them. Capture PNGs are taken at the display's device pixel ratio and reconciled automatically; `scale` snaps to 1/0.5/0.25 in that mode. `styleDiff` accompanies `topMismatches`: for each of the worst regions, the design node and the page element occupying the same box, their sizes when those disagree, and the computed properties that differ (`{ property, design, page }`). Both sides are measured by the same DOM walker that reads a capture, so the values are comparable property for property — this is what replaces inferring from class strings which utility won the cascade. Present whenever both sides could be measured: always for a live URL, and for a stored capture that has a `dom.json` |

### Browser capture

A human-driven browser session that turns a page velloo can't otherwise reach — behind a login, on staging, on a third-party site — into local evidence for the agent. The session is driven by the **user** from an in-page toolbar; the agent starts it and reads what comes back.

| Tool | Args | Returns |
|---|---|---|
| `start_capture_session` | `url?` | Opens a real browser window the user drives, and **returns immediately** with `{ sessionId }` — it does not wait for the session (a call held open for the length of a login would sit on the MCP connection long enough to trip the proxy). Poll `list_captures` for captures as the user makes them. Opening it emits an activity event and a daemon console notice, so an agent-started session is visible as one |
| `list_captures` | — | Stored captures for this folder, newest first: `captureId`, url, title, `capturedAt`, viewport, `themeOnly`, node/asset counts. Also returns `sessions[]` — every capture session this daemon opened, with `status` (`open`/`closed`), the page the user is on right now (`currentUrl`), when it opened and ended, and what it has captured. That is the polling signal: `start_capture_session` returns before the user has done anything, so without it an agent can see finished captures appear but not whether anyone is still in the browser |
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
- `move_node`, `remove_node`, `set_node_id`, `instantiate_snippet`, `update_snippet_instance`, and `update_props`'s bulk `patches` form all work the same way.

Two things to know:

- Edits broadcast as `snippet-changed` (not `screen-changed`), and the `update_snippet` lock guards them so a body edit and a wholesale `update_snippet` can't race.
- `$param` refs and `$if` branches are not `ComponentNode`s — `add_node` can't insert them. To add a `$param` placeholder or `$if` branch, use `update_snippet` with a patched `tree`.

The canvas's snippet editor view uses exactly this surface — the Inspector targets `screenId: "snippet:<id>"` for every mutation it commits.

### Locator-aware tools

`add_node`, `update_props` (single and `patches` bulk), `move_node`, `remove_node`, `inspect`, `instantiate_snippet`, `update_snippet_instance`, `set_node_id` — every `path`/`parentPath`/`fromPath`/`toParent` field accepts either a path array or an `@id` string. `set_node_id` targets `ComponentNode` and `SnippetInstance` — param refs can't carry ids.

## Advisory prop warnings

`add_node`, `update_props`, and `add_screen` validate props against the active library's manifest after the mutation succeeds and attach a `propWarnings: string[]` field to the result when something looks off — a typo'd prop name (with nearest-known suggestions), an enum value outside the declared set, or a boolean/number type mismatch. Warnings never fail the mutation: DOM passthrough props (`data-*`, `aria-*`, `className`, …) are exempt, components that declare no manifest props skip validation entirely, and `$param`/`$if` substitution values are ignored. Treat a warning as "this will probably render wrong" and self-correct in the same turn.

## Error model

Errors are discriminated unions with a `kind` field. Every mutation returns `Result<T, MutationError>`; routes map error variants to HTTP status codes and the MCP layer returns them as structured tool errors.

| `kind` | Meaning |
|---|---|
| `ScreenNotFound` | The named screen doesn't exist |
| `BoardNotFound` | The named board doesn't exist in the folder |
| `FrameNotFound` | The named frame doesn't exist on the given board; carries `boardId` + `frameId` |
| `BoardGroupNotFound` | The named sidebar group doesn't exist in `config.boardGroups`; carries `groupId` |
| `UnknownComponent` | `componentRef` not in the active palette; carries `suggestions[]` by Levenshtein distance |
| `InvalidPath` | Path doesn't resolve in the screen tree |
| `InvalidMove` | `move_node` would create a cycle or move into self |
| `LastScreen` | `remove_screen` refuses when only one screen is left |
| `ScreenInUse` | The strict removal variant (`removeScreenStrict`, HTTP layer) refuses when frames reference the screen; carries `usage: { boardId, frameIds[] }[]`. The MCP `remove_screen` tool cascades instead and never returns this |
| `ScreenIdConflict` | `add_screen` id collides with an existing screen |
| `ScreenIdExhausted` | Couldn't derive a unique screen id from the supplied name |
| `BoardIdConflict` | `add_board` id collides with an existing board |
| `BoardIdExhausted` | Couldn't derive a unique board id from the supplied name |
| `FrameIdConflict` | `add_frame` id collides with an existing frame on that board |
| `BadRequest` | Zod validation failed at the route boundary; carries the issue list |
| `SnippetNotFound` | The named snippet doesn't exist |
| `SnippetParamMismatch` | `args` to `instantiate_snippet` don't match the declared `params` (missing required, unknown extras, type mismatch) |
| `SnippetCycle` | Snippet body would reference itself (directly or transitively) |
| `SnippetInUse` | `remove_snippet` refuses while anything still instantiates it; splits the referencers into `screenIds[]` and `snippetIds[]` (other snippets whose body embeds this one) |
| `SnippetIdConflict` | `add_snippet` id collides with an existing snippet |
| `IdNotFound` | An `@id` locator didn't resolve to any node in the screen; carries `id` |
| `IdConflict` | Two nodes in the same screen share an `$id`; carries `id` + `paths[]` |
| `AnnotationConflict` | Two annotations on the same screen target the same locator |
| `AnnotationNotFound` | Annotation id doesn't exist on the named screen |
| `CanvasNoteNotFound` | Note id doesn't exist on any board |

## Initialize handshake

Server returns the standard MCP `initialize` response with surface-specific `instructions`. The shipped text lives in `packages/server/src/mcp/server.ts`.

Guided sessions receive the compact dispatch contract, the rule to request one exact schema only when needed, and the pointer to the `velloo://guide/*` resources. Full sessions receive the complete native-tool guidance, summarized below:

- **What Velloo is.** A pinned shadcn snapshot embedded in the binary; the design folder ships pure data. Designs are static — click handlers, routing, and forms are no-op.
- **First-pass discovery.** Before composing screens, call `list_components` (the default index groups 292 components into ~66 families and costs about a fifth of a per-component list; `filter` to a family for its prop names), `get_theme`, `list_snippets`, and `list_boards`. For an overview of an existing screen, use `get_screen mode: "outline"` (compact `ref + $id + classSnippet` tree) before pulling the full JSON.

### Grouping a library too large to read linearly

At 292 components a flat listing is both expensive and unhelpful: most of it is
sub-pieces (`FieldLabel`, `TabsList`) presented as peers of their own root, and
~two thirds of the bytes restate `source`/`category`/availability that are
identical for all but a handful. Descriptors therefore carry two browsing
fields, both generated rather than hand-listed:

- **`group`** — the shelf (`forms`, `overlays`, `chat`, …), from
  `COMPONENT_GROUPS` in `@velloo/provider`. The shadcn snapshot maps
  file → group in `src/groups.ts`; other providers may leave it unset, and
  anything unset lands in a visible catch-all bucket.
- **`family`** — the compound root (`FieldLabel` ⇒ `Field`), derived from the
  vendored file so a new family needs no second list.

The same two fields drive the canvas Library panel. That panel used to keep its
own hand-written id list, which is how the 2026.09 refresh left 20 new families
unbrowsable with nothing failing; the snapshot's manifest test now asserts every
vendored family is deliberately grouped.

Usage notes (`designModeNotes`) exist for the same reason and are scoped to one
job: naming the component that replaces a hand-rolled `Box` stack. Prop names
already say what `Field` accepts; only a note says that a label + control +
help-text stack is what it is *for* — which matters most for the families that
postdate most models' training data.
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
