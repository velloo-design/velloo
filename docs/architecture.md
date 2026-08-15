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
    ├── assets/                # imported images, SVGs (generate_image / generate_svg write here)
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
// .design/config.json
{
  "schemaVersion": 1,
  "toolVersion": "0.1.0",
  "library": {
    "id": "shadcn-react",
    "version": "2026.05.22",
    "source": "embedded:shadcn",
    "componentsPath": "embedded:shadcn"
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

The `library` field records which UI library this design folder is designed against and its embedded snapshot version (a `YYYY.MM.DD` date string matching `@velloo/shadcn-snapshot`'s `snapshotVersion`). `source: "embedded:shadcn"` is the default — the components live inside the Velloo binary, not the user's repo. `source: "shared:<path>"` (experimental, not yet implemented) would point at the user's app components instead.

`defaultBoard` + `defaultScreen` are optional hints the canvas uses on first load. `codegen.componentsAlias` lets the design folder declare the import prefix `emit_code` should suggest (`@/components/ui` for Next.js, `~/components/ui` for Astro, etc.).

## Runtime architecture

```
┌─────────────────────────────────────────────────────┐
│  Global tool (single binary, Bun SEA, ~30MB)        │
│  ┌──────────────────────────────────────────────┐   │
│  │ Pre-built canvas (static React app)          │   │
│  │ Embedded shadcn snapshot + manifest          │   │
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

Components are **embedded in the Velloo binary** (`@velloo/shadcn-snapshot` package). The design folder doesn't ship a `components/` directory.

This is a reversal of an earlier decision ( The reversion was driven by AI-agent confusion — two `button.tsx` files in the repo (one in the design folder, one in `apps/web/`) made the source of truth unclear. Embedded components keep the design folder pure data.

The snapshot today carries ~35 shadcn primitives (Accordion, Alert, AlertDialog, Avatar, Badge, Breadcrumb, Button, Calendar, Card+parts, Carousel, Chart, Checkbox, Collapsible, Dialog, DropdownMenu, Input, Label, Pagination, Popover, Progress, RadioGroup, ScrollArea, Select, Separator, Sheet, Skeleton, Slider, Sonner Toaster, Switch, Table+parts, Tabs, Textarea, Toggle, ToggleGroup, Tooltip) plus 9 Velloo helpers (`<Divider>`, `<Gradient>`, `<Heading>`, `<Icon>`, `<Image>`, `<Layer>`, `<Placeholder>`, `<SVG>`, `<Text>`). Overlay components (Dialog, AlertDialog, Sheet, Popover, DropdownMenu, Select, Tooltip, Sonner) have their Portal swapped for an inline pinned-open `<div>` in design mode — see `packages/shadcn-snapshot/src/components/canvas-portal.tsx` and. Calendar / Chart / Carousel are static fakes for the same reason (the real components require runtime state or canvas APIs Velloo deliberately doesn't simulate).

**Tailwind is JIT-compiled at server runtime** against the embedded component sources + the design folder's screens. Any utility Tailwind supports renders, including arbitrary-value classes. The `validate_classes` MCP tool answers "does this candidate compile under the active JIT?" before an agent commits to a `shadow-[…]` / `bg-[…]` form.

### Customizing components

How do users customize when the components are baked in? Short answer:

- **Per-instance className** (`apply_classes`) and **per-instance props** (`update_props`) handle most needs.
- **Snippets** are the supported "your version of a primitive" layer. A snippet wraps one or more components with typed params; every instance stays in sync.
- The **experimental shared-components mode** (below) is the escape hatch when neither of those is enough.

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
- **Theme operations** are MCP tools; the agent is the primary author of themes (`set_token`, `derive_palette_from_color`, `apply_preset`, `match_vibe`, `match_image`, `score_theme_contrast`).
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

## AI asset generators

`generate_svg` and `generate_image` are MCP tools that produce ready-to-stamp `<SVG>` / `<Image>` nodes from natural-language prompts.

- **`generate_svg`** posts the prompt to **Claude Haiku** (`claude-haiku-4-5`) with a constrained system prompt — inner SVG markup only, capped element count, no scripts/animations, `currentColor` by default so the result theme-flips. Output is cleaned (markdown fences stripped, full `<svg>` wrapper peeled), validated by a small allowlist of permitted tags, and returned either inline or persisted under `assets/`. Requires `ANTHROPIC_API_KEY`.
- **`generate_image`** has two routes. Default: Claude suggests alt text for the prompt, and the URL is a Picsum placeholder seeded by the prompt hash — same prompt always returns the same image, easy to swap for a real photo later, no API key required. Upgrade: if `FAL_KEY` is set and `filename` is given, the tool calls **fal.ai flux-schnell** and writes the binary to `assets/<filename>.png`.

Both tools return a `node:` shape (`{ $ref: "SVG" | "Image", props: { … } }`) the agent can drop into an `add_node` call directly.

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
