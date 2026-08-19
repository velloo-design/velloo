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
        └── marketing.notes.json   # sidecar: free-positioned markdown notes for this board
```

**Multi-board.** A design folder has many boards — typically one per flow (marketing, app, settings, onboarding). Each is a separate JSON file under `boards/` with its own frames + groups. The same screen can appear in multiple boards (and multiple frames within a single board); edits propagate everywhere because the underlying tree is shared. The Pulse sample ships three boards: Marketing, App, Playground.

**Sidecars.** Annotations are anchored to nodes within a screen and live at `screens/<screenId>.annotations.json`. Free-positioned markdown notes are board-scoped at `boards/<boardId>.notes.json`. Empty arrays delete the sidecar on persist — the directory stays clean when there's nothing there. Codegen ignores both kinds.

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

A board is one infinite canvas. It holds **frames** — placements of screens at chosen sizes and positions — and **groups** that visually tag related frames. Each board persists as `boards/<id>.json`; a folder typically has several.

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

### Config

```json
// .design/config.json (Sprint Y multi-library shape)
{
  "schemaVersion": 1,
  "toolVersion": "0.1.0",
  "projectId": "01J9C8N3M2X4Z6Y7K",
  "libraries": {
    "shadcn": {
      "id": "shadcn-react",
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

The `libraries` map (Sprint Y) declares every library this folder uses; each screen pins one via its own `library` field. `defaultLibrary` names the entry used when a screen doesn't specify. The legacy single-library shape (`library: Library` at the top level) still parses for backward compat — the server normalizes it to `libraries: { default: Library }` in-memory at load time.

The `extensions` map (Sprint Y) holds user-declared custom components — agent-registered via the `add_extension` MCP tool. Each entry records the bare `importPath` codegen emits, a hand-authored prop schema, and an `origin` tag (`"agent"` or `"manual"`). Extensions are folder-global: every screen in every library sees them. Extension ids shadow library components with the same name.

`source` is the canonical vocabulary for "where do the components live" — `"binary"` (default: shipped with the velloo binary, the embedded shadcn snapshot today), `"cache"` (Sprint X+1: `~/.velloo/<projectId>/...`), `"in-repo"` (Sprint X+1: the user's app folder), or `"shared:<path>"` (experimental — designed but not yet implemented). Legacy `"embedded:shadcn"` and `"registry:shadcn"` values are normalized in-memory at folder load.

`projectId` (optional) is a stable id used to key external-cache paths. Existing folders without one fall back to a path-derived hash.

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

Two ports started by `velloo run`:

- **:7300** Canvas (HTML/JS UI). The board renders frames as iframes; each iframe mounts a screen at the frame's current size, using components from the embedded shadcn snapshot. WebSocket for live updates.
- **:7301** MCP server (HTTP, streamable). Same backend the canvas writes through.

Both interfaces drive the same tool surface — agent edits and human edits are operationally identical. No "agent mode" vs "user mode" code paths.

## Component sourcing

Components come from the **active component provider** (`@velloo/provider`). The design folder doesn't ship a `components/` directory. Today the only provider that ships is the embedded shadcn snapshot; Sprint X+2 will add no-lib + MUI alongside, and a host-repo provider is later on the roadmap.

The provider interface is the contract every library entry implements:

```ts
interface ComponentProvider {
  id: string;                       // "shadcn-react", "none", "mui", "host"
  version: string;
  componentsDir: string;            // Tailwind JIT scan target
  styleEntryPath: string;           // Tailwind v4 @theme entry
  registry: ComponentRegistry;      // $ref → React component
  loadManifest(): Promise<Manifest>;
}
```

The renderer, the Tailwind JIT, MCP discovery, codegen — every consumer reads through this. The server's `MutationContext` carries one resolved `provider` instance per design folder, looked up at boot via a `ProviderLoader` (`packages/server/src/providers.ts`). This is a Sprint-X refactor of an earlier hardcoded design where every consumer imported from `@velloo/shadcn-snapshot` directly.

The reasoning behind not putting components on disk in the design folder still holds: an earlier draft had `velloo init` pull components into the design folder so the user "owned" them on disk. The reversion was driven by AI-agent confusion — two `button.tsx` files in the repo (one in the design folder, one in `apps/web/`) made the source of truth unclear. The provider abstraction keeps the design folder pure data while still letting different libraries take the active slot.

### shadcn providers (two flavors)

**`shadcn-upstream` (Sprint Z, default for new folders).** Fetches components from the official shadcn registry at a pinned version and deposits byte-identical vanilla shadcn into the user's app (or `~/.velloo/providers/shadcn-upstream-<projectId>/`). No Velloo modifications visible in the user's files — `npx shadcn add <component>` works alongside it. The canvas-safe contract (Radix portal replacements, runtime-state fakes for Calendar/Chart/Carousel) is applied through `@velloo/shadcn-adapter`'s wrap-at-render-time adapter layer.

**`shadcn-react` (legacy, back-compat).** The hand-vendored snapshot in `@velloo/shadcn-snapshot`. Pre-Sprint-Z folders default to this; existing folders keep working unchanged through the migration shim. Deprecation path is documented in; the snapshot stays registered for at least two more sprints before being collapsed into a shim around the upstream provider.

Both ship ~35 shadcn primitives (Accordion, Alert, AlertDialog, Avatar, Badge, Breadcrumb, Button, Calendar, Card+parts, Carousel, Chart, Checkbox, Collapsible, Dialog, DropdownMenu, Input, Label, Pagination, Popover, Progress, RadioGroup, ScrollArea, Select, Separator, Sheet, Skeleton, Slider, Sonner Toaster, Switch, Table+parts, Tabs, Textarea, Toggle, ToggleGroup, Tooltip) plus 9 Velloo helpers (`<Divider>`, `<Gradient>`, `<Heading>`, `<Icon>`, `<Image>`, `<Layer>`, `<Placeholder>`, `<SVG>`, `<Text>`).

Overlay components (Dialog, AlertDialog, Sheet, Popover, DropdownMenu, Select, Tooltip, Sonner) have their Portal swapped for an inline pinned-open `<div>` in design mode — see `packages/shadcn-adapter/src/lib/canvas-portal.tsx` (or the legacy snapshot's `canvas-portal.tsx`) and. Calendar / Chart / Carousel are static fakes for the same reason.

The snapshot's `snapshotVersion` (`2026.05.22` at the time of this section) is the legacy provider's `version`. The upstream provider's `version` reflects the date the cache was fetched.

### Tailwind is a canvas concern, not a provider concern

**Tailwind is JIT-compiled at server runtime** against the active provider's `componentsDir` + the design folder's screens. Any utility Tailwind supports renders, including arbitrary-value classes. The `validate_classes` MCP tool answers "does this candidate compile under the active JIT?" before an agent commits to a `shadow-[…]` / `bg-[…]` form.

Tailwind v4 stays embedded in the velloo binary forever, regardless of which provider is active. Per-instance overrides (`apply_classes`) are always Tailwind classes; codegen translates them to the user's styling system at emit time (verbatim for shadcn/no-lib; converted to `sx` props for MUI when that provider ships). The provider declares its own `@theme` block via `styleEntryPath`; it does not bring its own Tailwind major.

### Customizing components

How do users customize when the components are baked in? Short answer:

- **Per-instance className** (`apply_classes`) and **per-instance props** (`update_props`) handle most needs.
- **Snippets** are the supported "your version of a primitive" layer. A snippet wraps one or more components with typed params; every instance stays in sync.
- The **experimental shared-components mode** (below) is the escape hatch when neither of those is enough.

### Editing a snippet body

Snippet bodies are first-class editable surfaces — both in the canvas's snippet editor view and through MCP. The mutation layer treats any `screenId` prefixed with `snippet:` as a virtualized screen whose tree is the snippet's body; tree mutations route persistence back through `persistSnippet` and broadcast as `snippet-changed`. From an agent's perspective, `update_props({ screenId: "snippet:feature-row", path: [0, 1], propPatch: { className: "..." } })` works exactly like a screen edit. From the canvas's perspective, the Inspector targets the virtualized screen id and the same `mutate.updateProps` / `mutate.applyClasses` / `mutate.addNode` flows that drive board editing.

The renderer ships two snippet routes: `/api/render/snippet/:id` wraps the snippet in a centering Card with padding for library previews (used by masonry tiles + the Library Detail page); `/api/render/snippet-body/:id` renders the body *without* a wrapper, substituting `$param` refs in prop positions with their defaults and leaving `$param` nodes in child positions as visible Badge placeholders. The second route's iframe-reported click paths match the body's on-disk path space exactly, which is what makes Inspector-driven edits land on the right node.

### Stateful components

Stateful components (Sidebar, Toaster, Form-with-submit) get explicit **design-mode behavior** declarations: most are placeable with stub providers; a few are documented as not-renderable in canvas. These declarations live in the manifest (embedded alongside the components).

## Experimental: shared-components mode

The design folder owning its own components is the supported model. But for users with an existing app, having two copies of `button.tsx` floating around — one in `design/components/ui` and one in `apps/web/components/ui` — invites drift. An explicit, opt-in experimental mode lets the design folder point at the user's app components instead.

```bash
velloo init ./design --library shadcn --experimental-shared ../apps/web/components
```

`.design/config.json` records the choice:

```json
"library": {
  "id": "shadcn-react",
  "version": "2.3.4",
  "source": "shared:../apps/web/components",
  "componentsPath": "../apps/web/components",
  "experimental": "shared"
}
```

In shared mode, the canvas mounts components from the user's app folder directly. **No edits in the design folder; no copies; one source of truth.**

This is gated as experimental because the failure modes are real and not all in Velloo's control. The supported behavior is *good error reporting* — never silent failure — so the user knows exactly what to fix:

| Failure | Diagnostic |
|---|---|
| Component imports `'use server'` | "`button.tsx` is a server component; cannot render in the canvas. Move client-only logic into a `*.client.tsx` wrapper, or fall back to embedded mode." |
| Component requires a runtime provider not stubbed by Velloo | Names the missing provider, links to the contract doc, suggests either stubbing locally or falling back to embedded mode. |
| Component imports from `@/lib/auth` (or any app-internal path) that fails to resolve | Names the path, shows the import chain, suggests configuring a stub. |
| User edits a component, Tailwind class no longer compiles | Names the class, the file, the line, and suggests `validate_classes` to verify next time. |
| Manifest regeneration fails (prop types unparseable) | Names the file, the prop, the parser error; offers to skip the affected component with a manifest stub. |

The contract is the same as default mode (canvas-safe). The cost is operational: every component change in the user's app potentially affects the canvas. The benefit is no drift. Users who reach for this mode are explicitly trading safety for cohesion, and Velloo's job is to make the trade transparent.

Default mode users see no traces of this in their flow — it's a flag, not a tier, and it's not on the user-facing pitch.

### Framework expansion

The Library Registry is retained as an internal abstraction so a second library entry can ship cleanly if signal demands it. It is **not** a public promise: Velloo is positioned as shadcn-first, and a second library entry only ships after it satisfies the canvas-safe contract. Mantine / MUI / Chakra all rely on providers in ways that may exclude them; that's known and acceptable.

## Theme model

Unified tokens (single source) → adapters per framework.

- **Token tree:** colors, typography (font family, scale, line-height), spacing scale, radius, shadows.
- **Shadcn adapter:** maps tokens to shadcn CSS-variable conventions (`--primary`, `--primary-foreground`, …).
- **Color generation:** OKLCH lightness scales for accessibility — *not* HSL.
- **Theme operations** are MCP tools; the agent is the primary author of themes (`set_token`, `derive_palette_from_color`, `apply_preset`, `score_theme_contrast`).
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

Velloo ships no model-backed asset generation — there are no MCP tools that call an external API. The agent authors SVG/raster art itself and stores it with `upload_asset` (writes to `assets/`, returns a `/assets/<name>` URL for `<Image src>`). Velloo runs fully offline.

## Distribution

CLI-first. Single binary built with Bun's executable feature.

```bash
brew install velloo/tap/velloo             # Mac (primary)
scoop install velloo                       # Windows
npm install -g velloo                      # Node-based fallback
```

Binary embeds:

- Pre-built canvas (static React app)
- A cached copy of the latest first-party library entries (shadcn-react today) so `velloo init` works offline
- HTTP/MCP server
- All Node-equivalent runtime (via Bun)

Total size: ~25–40MB. Same shape as `gh`, `bun`, `tailwindcss`.

## Why CLI-first (not desktop-first)

- Devs already trust the pattern: `gh`, `bun`, `tailwindcss`, `tsc`.
- Cross-platform free.
- Engineering tax of Tauri + Mac codesigning + Windows Authenticode + auto-update is real and burns weeks before the product exists.
- A desktop shell wraps the same engine later if and when the user pulls for it.

## Versioning and reproducibility

The design folder's `.design/config.json` records two things:

- `toolVersion` — the binary version that created the folder
- `library.version` — the library version pulled at init (or last upgrade)

The components themselves are on disk inside the folder, so **git is the lock for design content**. The folder, including its components, restores byte-identically from any commit. Velloo only needs to track its own tool version, not the components.

The global tool reads the config on `run`. If the running binary is newer than the recorded `toolVersion`, it offers an upgrade path with a diff. The `library.version` field is informational — actual restoration is git's job.
