# Architecture

> Velloo's runtime, folder format, codegen, and distribution.

## Working directory

Designs live in a folder anywhere on disk — typically inside the user's repo, but the tool doesn't require it. The folder is the unit. Commit it, branch it, PR it. No `node_modules`. No Vite dependency. The folder is pure data.

```
my-product/
├── apps/web/                  # the user's real app, untouched
└── product-design/            # the design "file" (a folder)
    ├── .design/
    │   ├── config.json        # tool version, locked shadcn version, viewport presets, codegen options
    │   └── cache/             # gitignored: screenshots, build artifacts
    ├── theme/
    │   └── default.json       # unified tokens (colors, type, spacing, radius)
    ├── snippets/              # reusable subtrees with typed params
    │   ├── feature-card.json
    │   └── hero-banner.json
    ├── assets/                # imported images, SVGs
    └── pages/
        ├── onboarding.json    # one design page = N variants
        └── settings.json
```

## JSON schema (sketch)

```json
// pages/onboarding.json
{
  "name": "Onboarding",
  "variants": [
    {
      "id": "mobile",
      "name": "Mobile",
      "viewport": { "w": 390, "h": 844 },
      "tree": {
        "$ref": "Card",
        "props": { "className": "p-6" },
        "children": [
          { "$ref": "Heading", "props": { "level": 1, "children": "Welcome" } },
          { "$ref": "Button", "props": { "variant": "default", "children": "Continue" } }
        ]
      }
    },
    {
      "id": "desktop",
      "name": "Desktop",
      "viewport": { "w": 1440, "h": 900 },
      "tree": { "$ref": "...", "children": [] }
    }
  ]
}
```

A node is one of:

- `{ $ref: ComponentId, $id?, props?, children? }` — a real shadcn / velloo component
- `{ $snippet: SnippetId, $id?, args?, $extraClassName? }` — instance of a reusable subtree defined in `snippets/`. `$extraClassName` merges into the body's root element at render time — the escape hatch for one-off per-instance tweaks without forking the snippet
- `{ $param: ParamName }` — placeholder only valid inside a snippet body; substituted at render time

**Stable ids.** Component and snippet-instance nodes may carry an optional `$id` — a stable anchor that survives sibling insertions and deletions. Ids match `/^[a-zA-Z][a-zA-Z0-9_-]*$/` and are unique within a single variant tree (validated at persist time; conflicts surface as a typed `IdConflict` error). The same `$id` may repeat across variants of the same page so an anchor like `"hero-cta"` refers to the same semantic node in every variant. Agents address `$id`-bearing nodes via the locator form `"@id"` in any path-accepting tool (`update_props`, `apply_classes`, `move_node`, `remove_node`, `inspect`, `set_node_id`, etc.).

Inside snippet bodies, anywhere a value appears (prop values, children, etc.), two control forms are recognized:

- `{ "$param": "name" }` — replaced with the matching arg value
- `{ "$if": "name", "then": <value>, "else": <value> }` — picks a branch based on truthiness of `args.name`. Lets a snippet expose `featured: boolean`-style params that toggle class strings without leaking the whole `className` to every caller

Props are JSON literals. No fixtures in V0 — props inline.

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

```json
// .design/config.json
{
  "schemaVersion": 1,
  "toolVersion": "0.1.0",
  "componentSource": {
    "framework": "shadcn-react",
    "snapshotVersion": "2.3.4"
  },
  "viewportPresets": [
    { "name": "Mobile", "w": 390, "h": 844 },
    { "name": "Tablet", "w": 768, "h": 1024 },
    { "name": "Desktop", "w": 1440, "h": 900 }
  ]
}
```

## Runtime architecture

```
┌─────────────────────────────────────────────────────┐
│  Global tool (single binary, Bun SEA, ~30MB)        │
│  ┌──────────────────────────────────────────────┐   │
│  │ Pre-built canvas (static React app)          │   │
│  │ Pinned shadcn snapshots (multiple versions)  │   │
│  │ Tiny HTTP server (canvas + MCP)              │   │
│  │ JSON read/write, codegen, theme export       │   │
│  └──────────────────────────────────────────────┘   │
└────────────────┬────────────────────────────────────┘
                 │ operates on
                 ▼
┌─────────────────────────────────────────────────────┐
│  Design folder (anywhere on disk)                   │
│  Pure JSON; locked tool + shadcn versions           │
└─────────────────────────────────────────────────────┘
```

Two ports started by `velloo run`:

- **:7300** Canvas (HTML/JS UI). Each variant renders in its own iframe entry that mounts shadcn from the design tree. WebSocket for live updates.
- **:7301** MCP server (HTTP, streamable). Same backend that the canvas writes through.

Both interfaces drive the same tool surface — agent edits and human edits are operationally identical. No "agent mode" vs "user mode" code paths.

## Component sourcing (V0)

V0 ships with **bundled shadcn-react only**, locked per design folder.

- Pinned snapshot of shadcn at a known version (V0 commits to **Tailwind v4 only**).
- Prop schemas extracted via `ts-morph` at build time, embedded in the binary.
- ~25–30 most-used shadcn components for V0, plus a small `velloo/` set (typography, Icon over lucide-react).
- **Tailwind is JIT-compiled at server runtime** against the snapshot components + the live pages folder. Any utility Tailwind supports — including ones we never thought to safelist — renders.

Stateful components (Sidebar, Toaster, Form-with-submit) get explicit "design-mode behavior" declarations: most placeable with stub providers; a few documented as not-renderable. Per-component flags live in the bundled shadcn snapshot manifest.

`velloo upgrade` bumps the shadcn snapshot, shows a diff, prompts the user.

Plugin architecture and a "framework picker" UI are designed-in for V1+ (Mantine, MUI, etc.) but **not shipped at V0**.

## Theme model

Unified tokens (single source) → adapters per framework.

- **Token tree:** colors, typography (font family, scale, line-height), spacing scale, radius, shadows.
- **Shadcn adapter:** maps tokens to shadcn CSS-variable conventions (e.g. `--primary`, `--primary-foreground`).
- **Color generation:** OKLCH lightness scales for accessibility — *not* HSL.
- **Theme operations** are MCP tools; the agent is the primary author of themes (`set_token`, `derive_palette_from_color`, `apply_preset`, `match_vibe`).

`velloo theme:export ./apps/web/` writes `tailwind.config.ts` and `globals.css` in **diff mode** — shows changes, user applies manually. Never auto-overwrites user files.

## Codegen

`velloo emit ./design/pages/onboarding.json --to ./apps/web/app/onboarding/page.tsx`

Requirements for V0 codegen output:

- Idiomatic shadcn JSX
- Proper imports (`import { Button } from "@/components/ui/button"`)
- Tailwind class consolidation (no duplicates, no string-concat soup, deterministic merge order on conflicts)
- Prettier pass at the end
- Output indistinguishable from hand-written shadcn code
- Snippets emit as real React components under `components/snippets/<PascalName>.tsx` with typed props; instances become `<PascalName ... />` in pages

**This is the moment of truth.** If output is mediocre, the whole pitch collapses. Budget review iterations on real outputs, not just unit tests.

## Distribution

CLI-first. Single binary built with Bun's executable feature.

```bash
brew install velloo/tap/velloo             # Mac (primary)
scoop install velloo                       # Windows
npm install -g velloo                      # Node-based fallback
# Or: download binary from GitHub releases at github.com/velloo-app/velloo
```

Binary embeds:

- Pre-built canvas (static React app)
- Pinned shadcn snapshots (multiple versions, ~few MB each)
- HTTP/MCP server
- All Node-equivalent runtime (via Bun)

Total size: **~25–40MB**. Same shape as `gh`, `bun`, `tailwindcss`.

## Why CLI-first (not desktop-first)

- Devs already trust the pattern: `gh`, `bun`, `tailwindcss`, `tsc`.
- Cross-platform free.
- CI / scripting works trivially.
- Engineering tax of Tauri + Mac codesigning + Windows Authenticode + auto-update is real and burns weeks before the product exists.
- Desktop wraps the same engine in V1 (~2–4 weeks) — same code, deeper integration.

## V1 desktop app (planned)

- Tauri shell with file picker, recent projects list, system menu, system tray.
- Webview points at the same canvas the CLI serves.
- MCP server lives in tray, always-on; agents don't need a manual `run`.
- Shipped binaries on Mac/Windows; signed and notarized.
- Same code as CLI; new packaging only.

## Versioning and reproducibility

The design folder's `.design/config.json` locks both:

- `toolVersion` — the binary version that created the folder
- `componentSource.snapshotVersion` — the shadcn snapshot pinned at init

The global tool reads the lock on `run`. If the running binary is newer than the lock, it offers an upgrade path with a diff. If older, it fetches the locked snapshot from a manifest registry.

This is the **"Cargo.lock for designs"** pattern — and it's what makes "global tool, portable folder" actually work in practice. Without it, designs become unreproducible six months later.
