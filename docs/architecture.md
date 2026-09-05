# Architecture

> Velloo's runtime, folder format, component sourcing, and codegen.

## Working directory

Designs live in a folder anywhere on disk — typically inside the user's repo, but the tool doesn't require it. The folder is the unit. Commit it, branch it, PR it. No `node_modules`. No Vite dependency. The folder is pure data; components are embedded in the Velloo binary.

```
my-product/
├── apps/web/                  # the user's real app, untouched
└── product-design/            # the design "file" (a folder)
    ├── .design/
    │   ├── config.json        # tool version, library declaration, viewport presets, codegen options
    │   └── cache/             # gitignored: screenshots, build artifacts
    ├── theme/
    │   └── default.json       # unified tokens (colors, type, spacing, radius — derived dark via OKLCH)
    ├── snippets/              # reusable subtrees with typed params
    │   ├── stat-card.json
    │   ├── feature-row.json
    │   └── sidebar-nav-row.json
    ├── assets/                # imported images, SVGs
    ├── screens/               # one file per screen, plus optional annotation sidecars
    │   ├── landing.json
    │   ├── pricing.json
    │   ├── signup.json
    │   └── landing.annotations.json  # sidecar: node-anchored markdown
    └── boards/                # many boards — one file per board, plus optional note sidecars
        ├── marketing.json     # frames (placements of screens) + groups
        ├── app.json
        ├── playground.json
        └── marketing.notes.json   # sidecar: markdown notes for this board
```

**Multi-board.** A design folder has many boards — typically one per flow (marketing, app, settings, onboarding). Each is a separate JSON file under `boards/` with its own frames + groups. The same screen can appear in multiple boards (and multiple frames within a single board); edits propagate everywhere because the underlying tree is shared. The Pulse sample ships three boards: Marketing, App, Playground.

**Sidecars.** Annotations are anchored to nodes within a screen and live at `screens/<screenId>.annotations.json`. Markdown notes are board-scoped at `boards/<boardId>.notes.json` — free-positioned by default, or carrying an `attachment` naming the frame, screen and node they anchor to. Empty arrays delete the sidecar on persist — the directory stays clean when there's nothing there. Codegen ignores both kinds.

## JSON schema (sketch)

### Screen

A screen is one composition: one responsive React tree.

```json
// screens/landing.json
{
  "id": "landing",
  "name": "Landing",
  "tree": {
    "$ref": "Card",
    "props": { "className": "p-6 md:p-12 lg:max-w-4xl mx-auto" },
    "children": [
      { "$ref": "Heading", "props": { "level": 1, "children": "Welcome" } },
      { "$ref": "Text", "props": { "children": "Get started in seconds." } },
      { "$ref": "Button", "props": { "variant": "default", "children": "Continue" } }
    ]
  }
}
```

A node is one of:

- `{ $ref: ComponentId, $id?, props?, children? }` — a real shadcn / velloo component
- `{ $snippet: SnippetId, $id?, args?, $extraClassName? }` — instance of a reusable subtree defined in `snippets/`. `$extraClassName` merges into the body's root element at render time
- `{ $param: ParamName }` — placeholder, valid only inside a snippet body; substituted at render time

**Stable ids.** Component and snippet-instance nodes may carry an optional `$id` — a stable anchor that survives sibling insertions and deletions. Ids match `/^[a-zA-Z][a-zA-Z0-9_-]*$/` and are unique within a screen tree (validated at persist time; conflicts surface as a typed `IdConflict` error). Agents address `$id`-bearing nodes via the locator form `"@id"` in any path-accepting tool (`update_props`, `apply_classes`, `move_node`, `remove_node`, `inspect`, `set_node_id`, …).

Inside snippet bodies, two control forms are recognized anywhere a value appears:

- `{ "$param": "name" }` — replaced with the matching arg value
- `{ "$if": "name", "then": <value>, "else": <value> }` — picks a branch based on truthiness of `args.name`

Props are JSON literals. No fixtures — props inline.

```json
// snippets/feature-card.json
{
  "id": "feature-card",
  "name": "Feature Card",
  "params": [
    { "name": "title", "type": "string" },
    { "name": "body",  "type": "string" },
    { "name": "icon",  "type": "string", "default": "Sparkles" }
  ],
  "tree": {
    "$ref": "Card",
    "props": { "className": "p-6 flex flex-col gap-3" },
    "children": [
      { "$ref": "Icon", "props": { "name": { "$param": "icon" } } },
      { "$ref": "Heading", "props": { "level": 3, "children": { "$param": "title" } } },
      { "$ref": "Text",    "props": { "children": { "$param": "body" } } }
    ]
  }
}
```

Snippet instances reference their library entry by id:

```json
{ "$snippet": "feature-card", "args": { "title": "Fast", "body": "Snappy by default." } }
```

### Board

A board is one infinite canvas. It holds **frames** — placements of screens at chosen sizes and positions — and **groups** that visually tag related frames. Each board persists as `boards/<id>.json`; a folder typically has several. In the sidebar, boards are filed into **board groups** — areas of work, defined once in `config.boardGroups` and referenced by `Board.group` — which is a separate level from a board's own frame groups.

```json
// boards/marketing.json
{
  "id": "marketing",
  "name": "Marketing",
  "frames": [
    {
      "id": "f-landing-desktop",
      "screen": "landing",
      "x": 100, "y": 100,
      "w": 1440, "h": 900,
      "label": "Desktop",
      "group": "marketing"
    },
    {
      "id": "f-landing-mobile",
      "screen": "landing",
      "x": 1620, "y": 100,
      "w": 390, "h": 844,
      "label": "Mobile",
      "group": "marketing"
    },
    {
      "id": "f-signup",
      "screen": "signup",
      "x": 100, "y": 1100,
      "w": 1440, "h": 900,
      "group": "marketing"
    }
  ],
  "groups": [
    { "id": "marketing", "name": "Marketing flow", "color": "#7C3AED" }
  ]
}
```

Two frames pointing at the same screen always render the same underlying tree at different sizes — that's the single sync model. There is no per-frame override of the tree. Visual treatment in the canvas (linked badge, shared group color, hover highlight on siblings) makes the shared-screen relationship obvious at a glance, especially when screens are intermixed on the board (pricing + signup + landing-mobile + landing-desktop).

Frames are freely resizable. Snap-to-viewport-preset (mobile / tablet / desktop) is a UI affordance, not a data constraint — the underlying `w`/`h` is just a number.

**Themes attach to boards, never to screens or frames.** A theme is a property of the *viewing context*, not of the content: a screen's tree references semantic tokens (`bg-primary`, `text-muted-foreground`) and is theme-portable by construction. A board may pin a named theme via its optional `theme` field (absent = the folder default); every frame on that board renders with it. The same screen framed on two differently-pinned boards renders in both palettes with edits syncing to both — the mechanism behind side-by-side theme candidates. This mirrors the viewport rule (a frame property, not a screen property) and deliberately contrasts with `screen.library`, which *is* per-screen because a library changes what the tree's `$ref`s mean (content), whereas a theme only changes how its tokens bind (context). Server-side capture tools (`screenshot`, `compare_to_url`) resolve the same way the canvas does: explicit `theme:` arg, else the hosting board's pin (`pinnedThemeForScreen` — conflicting pins across hosting boards are an error, never a guess), else the folder default.

### Config

```json
// .design/config.json
{
  "schemaVersion": 3,
  "toolVersion": "0.1.0",
  "folderId": "9f2c1a7e-4b3d-4f7e-a1c2-0d9e8b7a6f5e",
  "libraries": {
    "shadcn": {
      "id": "shadcn-upstream",
      "version": "2026.05.22",
      "source": "binary",
      "componentsPath": "binary"
    },
    "marketing": {
      "id": "none",
      "version": "0.1.0",
      "source": "binary",
      "componentsPath": "binary"
    }
  },
  "defaultLibrary": "shadcn",
  "extensions": {
    "DataTable": {
      "importPath": "@/components/data-table",
      "category": "ui",
      "description": "Sortable, paginated table",
      "props": [
        { "name": "data", "type": "any[]", "optional": false, "control": "string" },
        { "name": "sortable", "type": "boolean | undefined", "optional": true, "control": "boolean" }
      ],
      "origin": "agent"
    }
  },
  "viewportPresets": [
    { "name": "Mobile", "w": 390, "h": 844 },
    { "name": "Tablet", "w": 768, "h": 1024 },
    { "name": "Desktop", "w": 1440, "h": 900 }
  ],
  "defaultScreen": "landing",
  "defaultBoard": "marketing",
  "codegen": { "componentsAlias": "@/components/ui" }
}
```

The `libraries` map declares every library this folder uses; each screen pins one via its own `library` field. `defaultLibrary` names the entry used when a screen doesn't specify. Both are required — the pre-v2 single-library shape no longer parses; `velloo upgrade` migrates old folders on disk.

The `extensions` map holds user-declared custom components — agent-registered via the `add_extension` MCP tool. Each entry records the bare `importPath` codegen emits, a hand-authored prop schema, and an `origin` tag (`"agent"` or `"manual"`). Extensions are folder-global: every screen in every library sees them. Extension ids shadow library components with the same name.

`source` is an enum answering "where do the components live" — `"binary"` (shipped with the velloo binary), `"cache"` (`~/.velloo/…`), or `"in-repo"` (the user's app folder). New shadcn folders are `in-repo`: `componentsPath` points at the parent of `ui/`, and the browser canvas consumes supported files there directly. The embedded snapshot remains the SSR and per-component fallback source, not the configured library location.

`folderId` (optional) is the folder's stable cloud identity (a UUID) — published share links carry it so any clone of the folder finds its links and comments. Meaningless until the folder first touches velloo-cloud.

`defaultBoard` + `defaultScreen` are optional hints the canvas uses on first load. `codegen.componentsAlias` lets the design folder declare the import prefix `emit_code` should suggest (`@/components/ui` for Next.js, `~/components/ui` for Astro, etc.).

## Runtime architecture

```
┌─────────────────────────────────────────────────────┐
│  Global tool (single binary, Bun SEA, ~30MB)        │
│  ┌──────────────────────────────────────────────┐   │
│  │ Pre-built canvas (static React app)          │   │
│  │ ComponentProvider loader + default shadcn    │   │
│  │ Embedded Tailwind v4 (canvas concern)        │   │
│  │ Tiny HTTP server (canvas + MCP)              │   │
│  │ JSON read/write, codegen, theme export       │   │
│  └──────────────────────────────────────────────┘   │
└────────────────┬────────────────────────────────────┘
                 │ operates on
                 ▼
┌─────────────────────────────────────────────────────┐
│  Design folder (anywhere on disk)                   │
│  ┌──────────────────────────────────────────────┐   │
│  │ Screens, snippets, theme, annotations (JSON) │   │
│  │ Boards (frame layout + per-board notes)      │   │
│  │ Config (tool + library declaration)          │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

One **persistent canvas daemon per folder**, with two thin clients attaching to it:

- **The daemon** = canvas (HTML/JS UI) + HTTP MCP + the authoritative in-memory state + watcher, one detached background process per design folder, keyed by the folder's realpath. Binds `:7300` if free, else any free port; records `{ pid, canvasUrl, mcpUrl, ports }` in `.design/cache/runtime.json`. Persistent — it outlives any session and self-exits after 5 min idle (no canvas tabs and no agents).
- **`velloo run`** ensures the daemon (spawning a detached one if needed) and stays in the foreground on a TTY with keys to background (`b`), stop (`s`), or open the browser (`o`). `--open` opens the browser immediately. `--background` (or a non-TTY) returns to the shell and leaves the daemon running. `velloo stop` / `velloo status` manage daemons.
- **`velloo mcp`** is the agent-facing entry — **stdio by default**: it ensures the daemon and *proxies* the agent's stdin/stdout JSON-RPC to the daemon's HTTP MCP. So N agents for a folder share one daemon (one writer, one canvas URL). `--http` prints the daemon's `StreamableHTTPServerTransport` URL for clients that dial instead of spawning. Each connection independently selects `guided` (default), `profile`, or `full` with `--surface`; the optional `--profile` chooses one of four workflow recipes before initialization.

**Which folder?** Every folder-taking command resolves through one path (`packages/cli/src/folder.ts`). An explicit arg wins — a project name from the repo manifest, else a path. Without an arg, a repo-root **`velloo.json` manifest** drives resolution when present: it names the repo's design folders (`{ "projects": { "web": "apps/web/velloo", … }, "defaultProject"?: … }`, a pure pointer file — design settings stay in each folder's `.design/config.json`). Resolution picks by cwd containment (inside a project's folder, or inside a directory holding exactly one project), then the only project, then `defaultProject`, then an interactive picker (`run`/`connect` on a TTY only; `mcp`/`ci` never prompt) or an error listing the names. Repos without a manifest keep the convention chain: `./velloo` → cwd → walk up for a `.design/config.json`. `velloo init` registers each new folder in the manifest (creating it at the git root when absent), so a monorepo's folders stay resolvable — each still gets its own daemon; projects are a within-repo concept, not a shared machine service.

Every MCP surface dispatches to the same registered native handlers, and agent edits and human edits remain operationally identical. Surface selection changes only which schemas are advertised and whether calls pass through the guided façade; there are no separate mutation code paths.

### The cloud surface: who owns the credential

The canvas shows the signed-in account, signs in, and publishes boards — but **`@velloo/server` never reads `~/.velloo`**. It stays credential-blind so an embedder can host the canvas without inheriting the CLI's identity. Everything it needs is *injected* into `createServer` by the daemon (which is the CLI, and does own `~/.velloo`).

The server *does* call velloo-cloud — `generate_asset`, `pull_comments`, `send_feedback` — but only ever with an injected `CloudAuth`, and never with a credential it went looking for. `CloudAuth` carries both a boot-time `token` and an optional `resolveToken()`; every call goes through `currentToken(cloud)`, which prefers the live read. That matters because the daemon snapshots the credential once at startup: without it, a user who signs in *after* hitting the paywall stays logged out to the MCP tools until they restart the server — exactly the flow a metered feature provokes. A `resolveToken` that throws (a credentials file mid-write) falls back to the snapshot rather than failing a call the old token could still serve.

The two canvas-facing capabilities are injected the same way:

- **`CanvasAuth`** (`packages/cli/src/daemon/canvas-auth.ts`) backs `GET /api/auth/status` and `POST /api/auth/login[/cancel]`. Status carries the account's email, display name, and plan (a `GET /v1/me`, cached 60s because the canvas polls) plus a `verified` tri-state: `null` when unknown, `false` when the cloud rejected the stored token — an expired credential still names its account rather than silently reading as signed out. Sign-in is the OAuth device flow, which can't finish inside one request: `beginLogin` returns as soon as there's a user code to display and leaves the polling loop running, writing the credential on success; the canvas watches `login` for the outcome.
- **`CanvasPublish`** (`packages/cli/src/daemon/canvas-publish.ts`) backs `/api/publish`. Because publishing takes tens of seconds, the server holds a **`PublishRunner`** (`packages/server/src/publish-run.ts`) — one run per folder, rejecting a concurrent `POST` with 409 — and the canvas polls `GET /api/publish/status` for the step, capture counter, and warnings, then the share URL.

Both routes degrade rather than break when nothing was injected: status reads as signed out, and a publish attempt answers 503 instead of pretending.

The publish pipeline itself lives in `packages/cli/src/publish/core.ts` and is shared verbatim by `velloo publish` and the canvas — one `publishDesign(cloud, pipeline, request, report)` emitting progress events that the command prints and the runner stores. The daemon lends it a **`PublishHost`** (its own loaded folder, resolved providers, and warm Tailwind JIT), so an in-canvas publish reuses the daemon's render pipeline instead of standing up a second one. Browser lifecycle stays with the caller: the one-shot command closes the pooled browser, the long-lived daemon keeps it.

## Component sourcing

Components come from the **active component provider** (`@velloo/provider`). The design folder doesn't ship a `components/` directory.

The provider contract is `FrameworkAdapter` (`packages/provider/src/adapter.ts`) — a base
`ComponentProvider` (id, version, componentsDir, styleEntryPath, registry, loadManifest)
plus optional capabilities an adapter takes over from the defaults:

```ts
interface FrameworkAdapter extends ComponentProvider {
  styleChannel?/styleChannels?      // the native styling channel(s): tailwind-classname | sx | style
  registryForChannel?(kind)         // per-channel runtime registry (none: Tailwind vs inline)
  catalog?()/installComponent?()    // component catalog with installed-status + per-component install
  renderPass?(theme, dark)          // SSR provider wrapping + critical CSS (MUI: emotion)
  codegenModule?                    // bare module emitted imports come from ("@mui/material")
  themeToNative?(theme, dark)       // velloo tokens → the framework's theme options POJO
  themeModule?                      // module shape for the native theme artifact (imports + factory)
  canvasBundleSpec?                 // per-screen exact/adapted/fallback browser sources
  mcpIntro?(channel)                // framework framing prepended to the MCP instructions
}
```

The renderer, the Tailwind JIT, MCP discovery, codegen — every consumer reads through this,
resolved **per screen** (`providerForScreen`). The server registers one factory per id in
`packages/server/src/providers.ts`. **The full authoring walkthrough — every registration
point for a new framework — is `docs/providers.md`.** Host/app components that exist only
in the user's codebase are not providers: a node carries `$emitAs` and codegen emits the
real import (the design-time render approximates with primitives).

Components are not put on disk in the design folder: two `button.tsx` files in the repo (one in the design folder, one in `apps/web/`) would make the source of truth unclear to AI agents. The provider abstraction keeps the design folder pure data while still letting different libraries take the active slot.

### The shadcn provider

**`shadcn-upstream` is the shadcn provider** — the default for new folders, and (since design-folder format v2) the only user-facing shadcn library id; the config shim migrates older `shadcn-react` folders to it. It is a fail-safe hybrid with a real-source first path. Server SSR uses `@velloo/shadcn-snapshot` so every folder can open offline. The browser canvas then collects only the screen's referenced ids and builds a mixed registry: client-safe host `components/ui` files are compile-checked and selected as `exact`; portal/state-heavy families use explicit `adapted` snapshot sources; missing or broken files use `fallback` sources independently. Velloo helpers participate in the same registry, compound children survive because the entire serialized tree is mounted once, and aliases resolve against `config.hostApp`. Source-directory changes invalidate the bundle and Tailwind JIT. A bounded host-manifest pass adds common CVA variants and explicit props to discovery. `component_status` and `/api/canvas/status` report the chosen fidelity and preflight errors rather than treating a visible fallback as exact. The snapshot package remains internal; its `id: "shadcn-react"` is a self-identity string only.

The whole-screen mount deliberately yields to `render:"live"` extension screens, because a
live island owns its SSR marker. Live islands remain the opt-in path for dynamic leaf
components such as charts; they are not how ordinary shadcn library components render.

The registry ships ~35 shadcn primitives (Accordion, Alert, AlertDialog, Avatar, Badge, Breadcrumb, Button, Calendar, Card+parts, Carousel, Chart, Checkbox, Collapsible, Dialog, DropdownMenu, Input, Label, Pagination, Popover, Progress, RadioGroup, ScrollArea, Select, Separator, Sheet, Skeleton, Slider, Sonner Toaster, Switch, Table+parts, Tabs, Textarea, Toggle, ToggleGroup, Tooltip) plus the 11 framework-neutral Velloo helpers from `@velloo/helpers` (`<Box>`, `<Divider>`, `<Gradient>`, `<Heading>`, `<Icon>`, `<Image>`, `<Layer>`, `<Placeholder>`, `<Prose>`, `<SVG>`, `<Text>`) — the helpers every other provider also reuses.

Overlay components (Dialog, AlertDialog, Sheet, Popover, DropdownMenu, Select, Tooltip, Sonner) have their Portal swapped for an inline pinned-open `<div>` in design mode — see the snapshot's `canvas-portal.tsx`. Calendar / Chart / Carousel are static fakes for the same reason.

The snapshot's `snapshotVersion` (`2026.05.22`) records the upstream shadcn pull the vendored components mirror; the upstream provider's `version` reflects the date its cache was fetched (defaulting to the snapshot's date).

### Tailwind is a canvas concern, not a provider concern

**Tailwind is JIT-compiled at server runtime** against the active provider's `componentsDir` + the shared `@velloo/helpers` sources + the design folder's screens. Any utility Tailwind supports renders, including arbitrary-value classes. The `validate_classes` MCP tool answers "does this candidate compile under the active JIT?" before an agent commits to a `shadow-[…]` / `bg-[…]` form.

Tailwind v4 stays embedded in the velloo binary regardless of which provider is active. Per-instance styling goes through the screen's **style channel** (`update_props`'s `style`): Tailwind `className` for shadcn/no-lib, an `sx` object for MUI, an inline `style` object for none/none — authored natively at design time, never translated at emit time. Codegen serializes whatever the channel holds (`className="…"` / `sx={{…}}` / `style={{…}}`). The provider declares its own `@theme` block via `styleEntryPath`; it does not bring its own Tailwind major.

### Customizing components

How do users customize when the components are baked in?

- **Per-instance className** (`apply_classes`) and **per-instance props** (`update_props`) handle most needs.
- **Snippets** are the supported "your version of a primitive" layer. A snippet wraps one or more components with typed params; every instance stays in sync.
- A **shared-components mode** (a future direction, not yet in the format — see below) would be the escape hatch when neither of those is enough.

### Editing a snippet body

Snippet bodies are first-class editable surfaces — both in the canvas's snippet editor view and through MCP. The mutation layer treats any `screenId` prefixed with `snippet:` as a virtualized screen whose tree is the snippet's body; tree mutations route persistence back through `persistSnippet` and broadcast as `snippet-changed`. From an agent's perspective, `update_props({ screenId: "snippet:feature-row", path: [0, 1], propPatch: { className: "..." } })` works exactly like a screen edit. From the canvas's perspective, the Inspector targets the virtualized screen id and the same `mutate.updateProps` / `mutate.applyClasses` / `mutate.addNode` flows that drive board editing.

The renderer ships two snippet routes: `/api/render/snippet/:id` wraps the snippet in a centering Card with padding for library previews (used by masonry tiles + the Library Detail page); `/api/render/snippet-body/:id` renders the body *without* a wrapper, substituting `$param` refs in prop positions with their defaults and leaving `$param` nodes in child positions as visible Badge placeholders. The second route's iframe-reported click paths match the body's on-disk path space exactly, which is what makes Inspector-driven edits land on the right node.

### Stateful components

Stateful components (Sidebar, Toaster, Form-with-submit) get explicit **design-mode behavior** declarations: most are placeable with stub providers; a few are documented as not-renderable in canvas. These declarations live in the manifest (embedded alongside the components).

## Future direction: shared-components mode

> **Not implemented.** Nothing below exists in the current format: the v2 `library.source` enum has no `shared:<path>` value (a config claiming one is rejected), and there is no `--experimental-shared` init flag. This section records the design intent.

The design folder consuming provider-embedded components is the supported model. But for users with an existing app, the canvas rendering a vendored copy of `button.tsx` while `apps/web/components/ui` holds the real one invites drift. The envisioned opt-in mode would let the design folder point at the user's app components instead: the canvas would mount components from the user's app folder directly — no edits in the design folder, no copies, one source of truth. (The live-island extension mechanism already exercises a narrow slice of this: bundling a real host component into the canvas.)

The mode would ship gated as experimental because the failure modes are real and not all in Velloo's control. The supported behavior is *good error reporting* — never silent failure — so the user knows exactly what to fix:

| Failure | Diagnostic |
|---|---|
| Component imports `'use server'` | "`button.tsx` is a server component; cannot render in the canvas. Move client-only logic into a `*.client.tsx` wrapper, or fall back to embedded mode." |
| Component requires a runtime provider not stubbed by Velloo | Names the missing provider, links to the contract doc, suggests either stubbing locally or falling back to embedded mode. |
| Component imports from `@/lib/auth` (or any app-internal path) that fails to resolve | Names the path, shows the import chain, suggests configuring a stub. |
| User edits a component, Tailwind class no longer compiles | Names the class, the file, the line, and suggests `validate_classes` to verify next time. |
| Manifest regeneration fails (prop types unparseable) | Names the file, the prop, the parser error; offers to skip the affected component with a manifest stub. |

The contract is the same as default mode (canvas-safe). The cost is operational: every component change in the user's app potentially affects the canvas. The benefit is no drift. Users who reach for this mode are explicitly trading safety for cohesion, and Velloo's job is to make the trade transparent.

Default mode users see no traces of this in their flow — it's a flag, not a tier, and it's not on the user-facing pitch.

### Framework adapters

Velloo is framework-native: the `ComponentProvider` is a **`FrameworkAdapter`**, and **MUI ships as a first-class native adapter** (real `@mui/material`, emotion SSR, `sx` styling, `createTheme` codegen) alongside shadcn and no-framework. A framework must satisfy the canvas-safe contract (MUI's overlays are inline-shimmed for design mode). Frameworks without an adapter (Mantine, NextUI, …) fall back to the no-framework provider via scan detection — the agent approximates their components with primitives and preserves the real imports via `$emitAs`.

## Theme model

Unified tokens (single source) → adapters per framework.

- **Token tree:** colors, typography (font family roles + **typesets**), spacing scale, radius, shadows.
- **Typesets:** typography is three rhythm controls (`size` / `leading` / `flow`) plus font roles, not a hand-listed scale. The h1–h6 / body / lead / small / caption ladder derives from them through the one ratio table in [`@velloo/schema/typeset`](../packages/schema/src/typeset.ts). That module has two output modes over the same ratios — CSS custom properties (`typesetCss`, for every channel that renders through a stylesheet) and concrete numbers (`typesetScale`, for the native framework themes that get serialized into codegen artifacts) — so the canvas, the emitted CSS, the MUI/antd/chakra themes, and the `Heading`/`Text` components cannot drift apart. `set_typeset` is the MCP surface; `Prose` wraps a content region in a `.typeset` (optionally a named preset).
- **Shadcn adapter:** maps tokens to shadcn CSS-variable conventions (`--primary`, `--primary-foreground`, …).
- **Color generation:** OKLCH lightness scales for accessibility — *not* HSL.
- **Theme operations** are MCP tools; the agent is the primary author of themes (`set_theme` for tokens/fonts/typeset/customCss and palette reseeding, `import_theme`, `score_theme_contrast`).
- **Preset library** ships 12 curated presets — `default-light`, `default-dark`, `violet`, `emerald`, `amber`, `rose`, `indigo`, `ocean`, `slate`, `forest`, `sunset`, `plum`. Each is a complete token tree so `apply_preset` swaps wholesale.
- **Contrast scoring** is built in: `score_theme_contrast` returns ratio + tier (`AAA` / `AA` / `AAlarge` / `Fail`) for every salient pair (`foreground/background`, `primary/primary-foreground`, etc.). The canvas's theme panel renders this inline.

`velloo theme:export ./apps/web/` writes `tailwind.config.ts` and `globals.css` in **diff mode** — shows changes, user applies manually. Never auto-overwrites user files.

## Codegen (agent-consumed)

`emit_code` produces a structured JSX-shaped intermediate representation intended for the user's AI agent to read, not for the user to paste into their app. The agent reads the emit alongside the user's existing app code, conventions, and routing, and writes the real file in the user's style.

What `emit_code` produces (per screen):

- JSX-shaped representation using the design folder's library identifiers (`<Button>`, `<Card>`) and Tailwind utility classes verbatim from the design
- Snippets emit as named subtrees with typed parameters — the agent decides whether to materialize them as real components in the user's app, or call `emit_snippet` for a per-snippet IR (PascalCase name, params, JSX body) and write each one as its own file
- Tailwind class consolidation (no duplicates, deterministic merge order on conflicts) is applied as an IR quality property
- No automatic import paths or prettier pass — the agent picks the right import path for the user's app (using `config.codegen.componentsAlias` as a hint) and runs the user's existing prettier/eslint as part of writing the file

The board layout (frame positions, sizes, groups) is **not** part of `emit_code` — it's canvas-only data. The agent emits one screen at a time and writes one file at a time, in the user's app structure.

Reference corpus (15–20 hand-curated `(screen.json, ideal page.tsx)` pairs) is retained as a **quality measure on the agent loop**, not a snapshot test on emit output. Test setup: feed the screen via MCP to a real agent, point it at a sample app, score the resulting file against the reference. Not yet built.

Drift detection is cut for `emit_code` — there's no longer a "last emit" file in the user's app to drift from. It survives only as a guard for `emit_theme`, which still writes Tailwind config and globals directly. The `velloo theme:export` CLI uses the same diff path and colorizes output for terminal display.

## Assets

The default path is **offline and free**: the agent authors SVG/raster art itself and stores it with `upload_asset` (writes to `assets/`, returns a `/assets/<name>` URL for `<Image src>`), or bulk-imports existing files by path with `import_assets`. Nothing here calls an external API, and a folder that never generates never leaves the machine.

`generate_asset` is the **one deliberate exception** — hosted, pay-as-you-go generation through velloo-cloud for the art an agent genuinely cannot author: photography, textured illustration, true vector logos, background removal. It is registered unconditionally (like `pull_comments`), and every unavailable path — logged out, feature off, out of credits, cloud unreachable — returns an agent-facing message that names the free local alternative rather than failing.

The client carries **no model names and no prices**. The caller states an *intent* — `photo`, `illustration`, `graphic`, `texture`, `icon`, `vector`, `mark`, `edit`, `cutout`, `upscale` — and velloo-cloud maps it to a model and a price. That seam is deliberate: upstream model quality and pricing churn constantly, so swapping the model behind `photo` must not require a velloo release. Only the intent *names* are a contract; an unknown one comes back as a 400 listing the live catalogue.

One call may return 1–4 variants (each charged), and `reference` feeds existing folder assets back in — as the subject for `edit`/`cutout`/`upscale`, or as style guidance for the text-to-image intents. Results land in `assets/` through the same `storeAsset` path as `upload_asset`, so a generated file is indistinguishable from an authored one afterwards. Generated SVG is sanitized server-side and re-checked locally with `svgLooksActive`, which **refuses** rather than repairs.

## Distribution

CLI-first. Single binary built with Bun's executable feature.

```bash
brew install velloo/tap/velloo             # Mac (primary)
scoop install velloo                       # Windows
npm install -g velloo                      # Node-based fallback
```

Binary embeds:

- Pre-built canvas (static React app)
- A cached copy of the latest first-party library entries (the shadcn snapshot runtime + helpers today) so `velloo init` works offline
- HTTP/MCP server
- All Node-equivalent runtime (via Bun)

Total size: ~25–40MB. Same shape as `gh`, `bun`, `tailwindcss`.

## Why CLI-first (not desktop-first)

- Devs already trust the pattern: `gh`, `bun`, `tailwindcss`, `tsc`.
- Cross-platform free.
- Engineering tax of Tauri + Mac codesigning + Windows Authenticode + auto-update is real and burns weeks before the product exists.
- A desktop shell wraps the same engine later if and when the user pulls for it.

## Versioning and reproducibility

The design folder's `.design/config.json` records three version facts:

- `schemaVersion` — the on-disk format version, and the only one that gates loading. The loader refuses a folder on any other version: older folders are migrated **on disk** by `velloo upgrade` (ordered pure migrations in `@velloo/schema`'s `migrate.ts`; the command stops the folder's daemon, rewrites config + annotation sidecars + theme documents, then re-validates the whole folder); newer folders need a newer binary.
- `toolVersion` — the binary version that created (or last upgraded) the folder. Informational.
- `library.version` — the library version recorded at init. Informational.

The design content itself is plain JSON in git, so **git is the lock for design content** — a folder restores byte-identically from any commit, and only `schemaVersion` decides whether this binary can read it.
