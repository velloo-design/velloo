# Architecture

> Velloo's runtime, folder format, codegen, and distribution.

## Working directory

Designs live in a folder anywhere on disk — typically inside the user's repo, but the tool doesn't require it. The folder is the unit. Commit it, branch it, PR it. No `node_modules`. No Vite dependency. The folder is pure data.

```
my-product/
├── apps/web/                  # the user's real app, untouched
└── product-design/            # the design "file" (a folder)
    ├── .design/
    │   ├── config.json        # tool version, library declaration, viewport presets, codegen options
    │   ├── manifest.json      # generated: prop schemas + design-mode behavior per component
    │   └── cache/             # gitignored: screenshots, build artifacts
    ├── components/            # the chosen library's components, pulled at init
    │   ├── ui/                # e.g. shadcn primitives: button.tsx, card.tsx, …
    │   └── velloo/            # Velloo helpers: Heading, Text, Icon, Placeholder
    ├── theme/
    │   └── default.json       # unified tokens (colors, type, spacing, radius)
    ├── snippets/              # reusable subtrees with typed params
    │   ├── feature-card.json
    │   └── hero-banner.json
    ├── assets/                # imported images, SVGs
    └── pages/
        ├── onboarding.json              # one design page = N variants
        ├── onboarding.annotations.json  # sidecar: node-anchored markdown
        ├── onboarding.notes.json        # sidecar: free-positioned markdown
        └── settings.json
```

**Sidecars** for annotations + canvas notes live alongside their page (`pages/<pageId>.annotations.json` and `pages/<pageId>.notes.json`). Empty arrays delete the sidecar on persist — the directory stays clean when a page has none. Codegen ignores both sidecar types; they're canvas-only data.

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

Props are JSON literals. No fixtures — props inline (

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

The `library` field declares which UI library this design folder uses, the on-disk version, and where its components live within the folder. There is only one model: the design folder has its own copy of the library, and the user's app installs the same library independently. The bridge between design and app is agent-mediated, not a build step. See *Component sourcing* below.

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
│  │ Pages, snippets, theme, annotations (JSON)   │   │
│  │ Library components (real .tsx files on disk) │   │
│  │ Generated manifest                           │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

Two ports started by `velloo run`:

- **:7300** Canvas (HTML/JS UI). Each variant renders in its own iframe entry that mounts shadcn from the design tree. WebSocket for live updates.
- **:7301** MCP server (HTTP, streamable). Same backend that the canvas writes through.

Both interfaces drive the same tool surface — agent edits and human edits are operationally identical. No "agent mode" vs "user mode" code paths.

## Component sourcing

Components are **not bundled** into the Velloo binary. They live on disk inside the design folder, pulled fresh from a known-good registry at `velloo init`. The user owns the files: they can read, modify, evolve, and commit them.

The mechanism is a **Library Registry** — Velloo's list of supported UI libraries. Each library entry declares where to fetch components, how to map theme tokens, what import path to emit for the user's app, and a contract the components must satisfy (canvas-safe: no `'use server'`, no required runtime providers, theme via CSS variables only).

```bash
velloo init ./design --library shadcn        # pulls latest shadcn-react components
velloo init ./design --library shadcn@2.3.4  # pin a specific version
```

The pulled components land at `design/<componentsPath>/`. Manifests (prop schemas + design-mode behavior declarations) are generated via `ts-morph` at init time and refreshed on `velloo upgrade`.

**Tailwind is JIT-compiled at server runtime** against the on-disk components + pages folder. Any utility Tailwind supports renders, including arbitrary-value classes.

### Single component-folder model

The design folder owns its copy of the library. The user's app installs the library independently. The two are connected by the user's AI agent, which reads designs through Velloo's MCP surface and writes the real app code in the user's conventions — not by a build step or a symlink.

Earlier drafts defined three modes (`isolated`, `shared`, `linked`). Modes existed to manage the design ↔ code coupling problem that the agent now handles. They are cut — see `decisions.md` #21, #22.

### Stateful components

Stateful components (Sidebar, Toaster, Form-with-submit) get explicit **design-mode behavior** declarations: most are placeable with stub providers; a few are documented as not-renderable in canvas. These declarations live in the per-folder generated manifest, not in the binary.

### Custom and modified components

Because components live on disk in the design folder, users can edit them directly — to explore visual variations, prototype new variants, or fix something the upstream library got wrong. These edits are design-time only; the agent sees them through MCP and decides how to apply them in the user's app on the next emit cycle.

### Library upgrades

`velloo upgrade ./design` pulls the latest library version, shows a per-file diff against the design folder's current copy, and lets the user accept or reject changes per file. The folder's `config.library.version` is bumped on success.

### Framework expansion

The Library Registry is retained as an internal abstraction so a second library entry can ship cleanly if signal demands it. It is **not** a public promise: Velloo is positioned as shadcn-first, and a second library only ships after it satisfies the canvas-safe contract. Mantine / MUI / Chakra all rely on providers in ways that may exclude them; that's known and acceptable. See `decisions.md` #2, #14, #22.

## Theme model

Unified tokens (single source) → adapters per framework.

- **Token tree:** colors, typography (font family, scale, line-height), spacing scale, radius, shadows.
- **Shadcn adapter:** maps tokens to shadcn CSS-variable conventions (e.g. `--primary`, `--primary-foreground`).
- **Color generation:** OKLCH lightness scales for accessibility — *not* HSL.
- **Theme operations** are MCP tools; the agent is the primary author of themes (`set_token`, `derive_palette_from_color`, `apply_preset`, `match_vibe`).

`velloo theme:export ./apps/web/` writes `tailwind.config.ts` and `globals.css` in **diff mode** — shows changes, user applies manually. Never auto-overwrites user files.

## Codegen (agent-consumed)

`emit_code` produces a structured JSX-shaped intermediate representation intended for the user's AI agent to read, not for the user to paste into their app. The agent reads the emit alongside the user's existing app code, conventions, and routing, and writes the real file in the user's style.

This is the load-bearing reframe. The earlier "indistinguishable from hand-written shadcn" quality bar moved off `emit_code` itself: agents do the last-mile translation across the variability of idiomatic shadcn (className ordering, `asChild`, RSC boundaries, Form integration, controlled vs uncontrolled, ref forwarding, the user's own wrappers).

What `emit_code` produces:

- JSX-shaped representation using the design folder's library identifiers (e.g. `<Button>`, `<Card>`) and Tailwind utility classes verbatim from the design
- Snippets emit as named subtrees with typed parameters — the agent decides whether to materialize them as real components in the user's app
- Tailwind class consolidation (no duplicates, deterministic merge order on conflicts) is still applied — it's a quality property of the IR, not a stylistic choice
- No automatic import paths or prettier pass — the agent picks the right import path for the user's app and runs their existing prettier/eslint as part of writing the file

Reference corpus (15–20 hand-curated `(design.json, ideal page.tsx)` pairs) is retained as a **quality measure on the agent loop**, not a snapshot test on emit output. Test setup: feed the design via MCP to a real agent, point it at a sample app, score the resulting file against the reference.

Drift detection is cut for `emit_code` — there's no longer a "last emit" file in the user's app to drift from. It survives only as a guard for `emit_theme`, which still writes Tailwind config and globals directly.

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
- A cached copy of the latest first-party library entries (shadcn-react today; Mantine/MUI as they're added) so `velloo init` works offline
- HTTP/MCP server
- All Node-equivalent runtime (via Bun)

Total size: **~25–40MB**. Same shape as `gh`, `bun`, `tailwindcss`. The cached library copies are refreshed on the binary's auto-update check; `velloo init --fresh` always re-pulls from upstream.

## Why CLI-first (not desktop-first)

- Devs already trust the pattern: `gh`, `bun`, `tailwindcss`, `tsc`.
- Cross-platform free.
- CI / scripting works trivially.
- Engineering tax of Tauri + Mac codesigning + Windows Authenticode + auto-update is real and burns weeks before the product exists.
- Desktop wraps the same engine in V1 (~2–4 weeks) — same code, deeper integration.

## Desktop app (planned, post near-term sprints)

- Tauri shell with file picker, recent projects list, system menu, system tray.
- Webview points at the same canvas the CLI serves.
- MCP server lives in tray, always-on; agents don't need a manual `run`.
- Shipped binaries on Mac/Windows; signed and notarized.
- Same code as CLI; new packaging only.

## Cloud (planned, narrow)

Cloud is **additive** and narrow. The local CLI works without it forever. There is one paid cloud surface:

- **Velloo Cloud (PR Preview)** — managed hosted version of the PR Preview GitHub Action. Runs Playwright renders on Velloo's infrastructure; posts before/after design screenshots on every PR; hosted viewer for richer interactivity than a static image. The self-hostable Action is the open-source foundation; the paid version sells the operational convenience.

What's cut from earlier cloud framing (and why):

- **Hosted MCP gateway** — weak willingness-to-pay. Solo devs run agents locally.
- **Cloud-hosted designs** — splits source of truth, weakens "your files in your repo" pitch.
- **Real-time multiplayer** — git is the collaboration model. PR Preview is the async-collab feature.
- **Private library packs / SSO / SAML / audit log / SLA** — enterprise sales motion mismatched with the persona.

Cloud build order: auth → billing → PR Preview render pipeline → hosted viewer. Each lands as a sprint when its prerequisites are met; see `roadmap.md`.

## Versioning and reproducibility

The design folder's `.design/config.json` records two things:

- `toolVersion` — the binary version that created the folder
- `library.version` — the library version pulled at init (or last upgrade)

The components themselves are on disk inside the folder, so **git is the lock for design content**. The folder, including its components, restores byte-identically from any commit. Velloo only needs to track its own tool version, not the components.

The global tool reads the lock on `run`. If the running binary is newer than the lock, it offers an upgrade path with a diff. The library version field is informational — actual restoration is git's job.
