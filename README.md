<div align="center">

<img src="./.github/assets/velloo-mark-512.png" alt="Velloo" width="96" height="96">

# Velloo

**Design like a developer. Build like a designer.**

Design and code, finally the same shape.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-FFAB1F.svg)](https://www.apache.org/licenses/LICENSE-2.0)

</div>

---

Velloo is a **local-first, code-shaped design canvas**. Your AI agent does the design labor — composing screens from your real components and writing them into your app in your conventions — while you keep the taste and the calls. Designs live in your repo as JSON made of real components, not behind a seat in a vector tool you have to translate back into code.

No Figma seats. No paste-ready JSX you babysit. No translation tax.

See [`docs/`](./docs) for the architecture and the MCP reference.

## Quickstart

Velloo isn't on npm yet — install the hosted build (it runs on the [Bun](https://bun.sh) runtime, ≥ 1.3.0; the installer offers to set that up too):

```bash
curl -fsSL https://get.velloo.dev/install.sh | bash
```

Then, from inside your app:

```bash
cd ~/code/my-shadcn-app
velloo init
```

The interactive wizard creates the design folder (default `velloo/`) and wires up your AI agent — **Claude Code** (`.mcp.json` + the `velloo-design` skill) and **Cursor** (`.cursor/mcp.json` + a project rule); restart the agent so it loads the new config. **Start from scratch** (pick a component library + a sample or blank board) or **scan what you have**: scan detects your shadcn + Tailwind versions, imports your real theme from `globals.css`, and builds one screen per route, so the canvas opens in your brand colors. `init` never writes into your app's source — it only creates the design folder (plus the agent config).

Then start it:

```bash
velloo run velloo      # the design folder you just created
```

Two files define the model: a repo-root **`velloo.json`** names each design folder as a project (`init` registers it — several can coexist in a monorepo), and **`.design/config.json`** marks a directory as a design folder. Every folder-taking command (`run`, `stop`, `publish`, `emit`, …) accepts a project name or a path, and resolves via `velloo.json` when you pass nothing.

- **Canvas:** http://localhost:7300
- **MCP server (for your AI agent):** http://localhost:7301/mcp

`Ctrl-C` stops the server. Re-run the install command anytime to update to the latest build; `bun remove -g velloo` uninstalls.

### Screenshots — the one optional extra

A headless Chromium is used for exactly two things: your agent's `screenshot` tool (so it can *see* a design) and `velloo render <screen> --to=out.png`. The canvas, editing, `velloo publish`, `velloo emit`, and everything else work without it. Install it anytime (one-time, ~150 MB):

```bash
bunx playwright install chromium
```

If a screenshot fails, run exactly that command, then retry. Ports busy? Pass `--port` / `--mcp-port` to `velloo run`.

## What it does

- **Board + Screen + Frame** mental model. A design folder hosts many boards; frames sharing a screen stay in sync.
- **Framework-native.** A folder targets a framework — shadcn (Tailwind `className`), MUI (`sx` + emotion, real `@mui/material`), or no-framework (bare primitives) — each rendered, styled, and emitted in its own idiom.
- **MCP surface for agents.** Discovery, tree mutations, screen / frame / board / snippet lifecycle, theme ops, inspect + dark-diff, screenshot + render_snippet, and an agent-consumed `emit_code` IR.
- **Pulse sample** ships with `velloo init` — three boards (Marketing + App + Playground), seven screens, with full dark-mode coverage.
- **Components come from a `ComponentProvider`.** The design folder is pure data (no `components/*.tsx`); customization happens through snippets.

## Local-first by default

The local tool is free, complete, account-free, and telemetry-free — nothing in the solo loop phones home. The only outbound calls are the optional, opt-in cloud paths, and every one of them is gated behind an explicit `velloo login`:

- `velloo login` / `velloo publish` — publish boards as a read-only share link (`--list` what you've published, `--remove` to take one down)
- `velloo folder` — the repo's design folders: `list`, `add` another, `remove` one
- `pull_comments` — pull comments left on your share links back into the canvas as annotations
- `generate_asset` — hosted image/SVG generation, metered against your account
- `send_feedback` — agent-side product feedback, registered only when enabled in the folder config

You choose when — and whether — to make any of them.

## Repo layout

- `packages/schema` — Zod schemas + TS types for the design folder format
- `packages/shadcn-snapshot` — pinned shadcn components, embedded in the binary
- `packages/renderer` — design JSON → HTML (and PNG via Playwright)
- `packages/codegen` — agent-consumed IR + theme emitters
- `packages/server` — HTTP + MCP + mutations + theme + watcher
- `packages/canvas` — Vite/React canvas UI
- `packages/cli` — `velloo` CLI (citty)

## Local dev

```bash
bun install
bun --cwd packages/shadcn-snapshot run build    # build dist/manifest.json
bun --cwd packages/canvas run build             # build canvas SPA
bun run typecheck
bun run velloo init /tmp/velloo-smoke
bun run velloo run /tmp/velloo-smoke            # canvas at :7300, MCP at :7301
```

The Playwright screenshot path requires `bunx playwright install chromium` once.

## License

Velloo is open source under the Apache License 2.0. The **Velloo** name and the interlinked-frames mark are trademarks and are not covered by the code license — fork the code freely, but do not ship a derivative under the Velloo name or logo.
