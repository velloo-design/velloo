<div align="center">

<img src="./.github/assets/velloo-mark-512.png" alt="Velloo" width="96" height="96">

# Velloo

**Design like a developer. Build like a designer.**

Design and code, finally the same shape.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-FFAB1F.svg)](https://www.apache.org/licenses/LICENSE-2.0)

</div>

---

Velloo is a **local, agent-driven canvas for redesigning an existing React screen**. Your AI coding agent creates real screens, explores alternatives, and checks the result visually against the running app. You direct the work on the canvas, then carry the chosen direction back into your application in its own conventions.

Designs stay beside your code as readable JSON. The local workflow needs no account; when a review benefits from other people, publish a board into a lightweight team workspace or send an external share link. Teammates and outside reviewers can comment on the result, and those comments return to the local canvas for the agent to resolve.

No Figma seats. No paste-ready JSX you babysit. No translation tax.

See [`docs/`](./docs) for the architecture and the MCP reference.

## Quickstart

Install Velloo globally with npm. The package selects an exact official Bun
platform package with no install scripts; you do not need to install or manage
Bun yourself:

```bash
npm install -g velloo
```

pnpm works too: `pnpm add -g velloo`.

Or use the standalone installer (macOS and Linux):

```bash
curl -fsSL https://get.velloo.design/install.sh | bash
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

### MCP context surfaces

Velloo defaults to a compact progressive-disclosure surface: the agent sees
`call_velloo`, `run_velloo_plan`, and `operation_schema`, plus an enum naming the
available native operations. It pays for one native schema only when it needs
that schema; failed calls include the exact correction schema automatically.

Clients that do better with conventional function schemas can advertise every
native tool directly instead:

```bash
velloo mcp --surface full
```

Both surfaces carry the whole operation catalogue. Steering an agent toward a
particular workflow is the job of a skill or a `velloo://guide/*` resource, not
of a narrowed tool set — an allow-list chosen before the session can't know that
the code-to-design run will end on a comment thread, and the surface is fixed
once the session starts.

HTTP clients use the printed query-bearing URL. MCP configuration can also set
`VELLOO_MCP_SURFACE`. The shared canvas daemon remains one writer; each MCP
session independently selects its public tool surface.

`Ctrl-C` stops the server. Velloo periodically checks for a newer release without delaying commands and prints a small notice when one is available. Run `velloo upgrade` to update through the channel that installed it (npm-global or standalone). To migrate an older design-folder format, pass the folder explicitly: `velloo upgrade <folder>`.

### Screenshots — the one optional extra

A headless Chromium is used for exactly two things: your agent's `screenshot` tool (so it can *see* a design) and `velloo render <screen> --to=out.png`. The canvas, editing, `velloo publish`, `velloo emit`, and everything else work without it. Install it anytime (one-time, ~150 MB):

```bash
velloo browser install
```

If a screenshot fails, run exactly that command, then retry. Ports busy? Pass `--port` / `--mcp-port` to `velloo run`.

## What it does

- **Existing-screen redesign.** Start from one React route or captured authenticated page, recreate a faithful baseline, explore alternatives, and compare the result with the running product at the same viewport.
- **Board + Screen + Frame** mental model. A design folder hosts many boards; frames sharing a screen stay in sync.
- **Current React adapters.** shadcn + Tailwind, Material UI, Ant Design, Chakra UI, and no-library React folders each render and emit through their implemented adapter.
- **Visual verification.** The agent can inspect rendered nodes, take screenshots, compare with a live URL or authenticated capture, and resolve visible differences instead of guessing from code.
- **MCP surface for agents.** Discovery, focused tree mutations, themes, screenshots, comparison, comments, and agent-consumed implementation IR.
- **Components come from a `ComponentProvider`.** The design folder stays pure data. For shadcn, client-safe files in the app are mounted directly in the canvas; portal/state-heavy families are explicitly adapted, and compile failures fall back per component with diagnostics. Snippets remain the editable composition layer for app-specific patterns.
- **Optional collaboration.** Create an organization/team, invite a teammate, publish a board into that team, share externally, and bring review comments back to the local canvas.

## Local-first by default

The local tool is free, complete, account-free, and telemetry-free. The CLI makes one anonymous infrastructure request outside the solo loop: at most daily, a detached check reads the public npm release version and caches it locally; it sends no project or account data and can be disabled with `VELLOO_DISABLE_UPDATE_CHECK=1`. Product cloud calls remain optional and opt-in, and every one is gated behind an explicit `velloo login`:

- `velloo login` / `velloo publish` — publish boards to a personal or team workspace and create an external review link (`--list` what you've published, `--remove` to take one down)
- `velloo folder` — the repo's design folders: `list`, `add` another, `remove` one
- comment tools — read and resolve local, team, and external-review feedback on the canvas
- `generate_asset` — hosted image/SVG generation, metered against your image-generation credit balance
- `send_feedback` — agent-side product feedback, registered only when enabled in the folder config

You choose when — and whether — to make any of them.

## Repo layout

- `packages/schema` — Zod schemas + TS types for the design folder format
- `packages/shadcn-snapshot` — pinned shadcn SSR fallback + canvas-safe adaptations, embedded in the binary
- `packages/renderer` — design JSON → HTML (and PNG via Playwright)
- `packages/codegen` — agent-consumed IR + theme emitters
- `packages/server` — HTTP + MCP + mutations + theme + watcher
- `packages/canvas` — Vite/React canvas UI
- `packages/cli` — `velloo` CLI (citty)

## Local dev

```bash
bun install
bun --cwd packages/shadcn-snapshot run vendor   # re-pull shadcn from upstream (rare)
bun --cwd packages/shadcn-snapshot run build    # build dist/manifest.json
bun --cwd packages/canvas run build             # build canvas SPA
bun run typecheck
bun run velloo init /tmp/velloo-smoke
bun run velloo run /tmp/velloo-smoke            # canvas at :7300, MCP at :7301
```

The Playwright screenshot path requires `velloo browser install` once.

## License

Velloo is open source under the Apache License 2.0. The **Velloo** name and the interlinked-frames mark are trademarks and are not covered by the code license — fork the code freely, but do not ship a derivative under the Velloo name or logo.
