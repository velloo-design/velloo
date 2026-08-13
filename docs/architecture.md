# Architecture

> Velloo's runtime, folder format, component sourcing, and codegen.

## Working directory

Designs live in a folder anywhere on disk — typically inside the user's repo, but the tool doesn't require it. The folder is the unit. Commit it, branch it, PR it. No `node_modules`. No Vite dependency. The folder is pure data plus a copy of the chosen library's components.

```
my-product/
├── apps/web/                  # the user's real app, untouched
└── product-design/            # the design "file" (a folder)
    ├── .design/
    │   ├── config.json        # tool version, library declaration, viewport presets, codegen options
    │   ├── manifest.json      # generated: prop schemas + design-mode behavior per component
    │   └── cache/             # gitignored: screenshots, build artifacts
    ├── components/            # the chosen library's components, pulled at init
    │   ├── ui/                # shadcn primitives: button.tsx, card.tsx, …
    │   └── velloo/            # Velloo helpers: Heading, Text, Icon, Placeholder
    ├── theme/
    │   └── default.json       # unified tokens (colors, type, spacing, radius)
    ├── snippets/              # reusable subtrees with typed params
    │   ├── feature-card.json
    │   └── hero-banner.json
    ├── assets/                # imported images, SVGs
    ├── screens/               # one file per screen
    │   ├── landing.json
    │   ├── pricing.json
    │   ├── signup.json
    │   ├── landing.annotations.json  # sidecar: node-anchored markdown
    │   └── landing.notes.json        # sidecar: free-positioned markdown
    └── board.json             # canvas layout: where frames sit, sizes, labels
```

**Sidecars** for annotations + screen-level notes live alongside their screen (`screens/<screenId>.annotations.json`). Empty arrays delete the sidecar on persist — the directory stays clean when a screen has none. Codegen ignores both sidecar types; they're canvas-only data. Board-level notes (free-positioned markdown anywhere on the board) live in `board.notes.json` at the folder root.

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

The board is the canvas. It holds **frames** — placements of screens at chosen sizes and positions.

```json
// board.json
{
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
    "version": "2.3.4",
    "source": "registry:shadcn",
    "componentsPath": "components"
  },
  "viewportPresets": [
    { "name": "Mobile", "w": 390, "h": 844 },
    { "name": "Tablet", "w": 768, "h": 1024 },
    { "name": "Desktop", "w": 1440, "h": 900 }
  ]
}
```

The `library` field declares which UI library this design folder uses, the on-disk version, and where its components live within the folder. The default model is straightforward: the design folder owns its copy of the library, the user's app installs the same library independently, and the agent is the bridge.

## Runtime architecture

```
┌─────────────────────────────────────────────────────┐
│  Global tool (single binary, Bun SEA, ~30MB)        │
│  ┌──────────────────────────────────────────────┐   │
│  │ Pre-built canvas (static React app)          │   │
│  │ Library Registry + cached library copies     │   │
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
│  │ Board (frame layout) (JSON)                  │   │
│  │ Library components (real .tsx files on disk) │   │
│  │ Generated manifest                           │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

Two ports started by `velloo run`:

- **:7300** Canvas (HTML/JS UI). The board renders frames as iframes; each iframe mounts a screen at the frame's current size, using the design folder's library. WebSocket for live updates.
- **:7301** MCP server (HTTP, streamable). Same backend the canvas writes through.

Both interfaces drive the same tool surface — agent edits and human edits are operationally identical. No "agent mode" vs "user mode" code paths.

## Component sourcing

Components are **not bundled** into the Velloo binary. They live on disk inside the design folder, pulled fresh from a known-good registry at `velloo init`. The user owns the files: they can read them, modify them, evolve them, commit them.

The mechanism is a **Library Registry** — Velloo's list of supported UI libraries. Each entry declares where to fetch components, how to map theme tokens, what import path to emit for the user's app, and a contract the components must satisfy (canvas-safe: no `'use server'`, no required runtime providers, theme via CSS variables only).

```bash
velloo init ./design --library shadcn        # pulls latest shadcn-react components
velloo init ./design --library shadcn@2.3.4  # pin a specific version
```

The pulled components land at `design/<componentsPath>/`. Manifests (prop schemas + design-mode behavior declarations) are generated via `ts-morph` at init and refreshed on `velloo upgrade`.

**Tailwind is JIT-compiled at server runtime** against the on-disk components + screens folder. Any utility Tailwind supports renders, including arbitrary-value classes.

### Default: design-folder-owned components

The design folder owns its copy of the library. The user's app installs the library independently. The two are connected by the user's AI agent, which reads designs through MCP and writes the real app code in the user's conventions — not by a build step or a symlink.

Most users will never edit `design/components/ui/button.tsx`. The expectation is that the on-disk library is read-mostly. But because the files are real, on disk, owned by the user: it's available as an escape hatch if needed. Edits show up immediately in the canvas, are visible to the agent on the next emit, and survive in git.

### Stateful components

Stateful components (Sidebar, Toaster, Form-with-submit) get explicit **design-mode behavior** declarations: most are placeable with stub providers; a few are documented as not-renderable in canvas. These declarations live in the per-folder generated manifest, not in the binary.

### Library upgrades

`velloo upgrade ./design` pulls the latest library version, shows a per-file diff against the design folder's current copy, and lets the user accept or reject changes per file. The folder's `config.library.version` is bumped on success.

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
| Component imports `'use server'` | "`button.tsx` is a server component; cannot render in the canvas. Move client-only logic into a `*.client.tsx` wrapper, or fall back to owned-components mode." |
| Component requires a runtime provider not stubbed by Velloo | Names the missing provider, links to the contract doc, suggests either stubbing locally or moving to owned-components mode. |
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
- **Theme operations** are MCP tools; the agent is the primary author of themes (`set_token`, `derive_palette_from_color`, `apply_preset`, `match_vibe`, `match_image`).

`velloo theme:export ./apps/web/` writes `tailwind.config.ts` and `globals.css` in **diff mode** — shows changes, user applies manually. Never auto-overwrites user files.

## Codegen (agent-consumed)

`emit_code` produces a structured JSX-shaped intermediate representation intended for the user's AI agent to read, not for the user to paste into their app. The agent reads the emit alongside the user's existing app code, conventions, and routing, and writes the real file in the user's style.

What `emit_code` produces (per screen):

- JSX-shaped representation using the design folder's library identifiers (`<Button>`, `<Card>`) and Tailwind utility classes verbatim from the design
- Snippets emit as named subtrees with typed parameters — the agent decides whether to materialize them as real components in the user's app
- Tailwind class consolidation (no duplicates, deterministic merge order on conflicts) is applied as an IR quality property
- No automatic import paths or prettier pass — the agent picks the right import path for the user's app and runs the user's existing prettier/eslint as part of writing the file

The board layout (frame positions, sizes, groups) is **not** part of `emit_code` — it's canvas-only data. The agent emits one screen at a time and writes one file at a time, in the user's app structure.

Reference corpus (15–20 hand-curated `(screen.json, ideal page.tsx)` pairs) is retained as a **quality measure on the agent loop**, not a snapshot test on emit output. Test setup: feed the screen via MCP to a real agent, point it at a sample app, score the resulting file against the reference.

Drift detection is cut for `emit_code` — there's no longer a "last emit" file in the user's app to drift from. It survives only as a guard for `emit_theme`, which still writes Tailwind config and globals directly.

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
