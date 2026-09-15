<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./.github/assets/velloo-lockup-dark.png">
    <img src="./.github/assets/velloo-lockup.png" alt="Velloo" width="205">
  </picture>
</h1>

**Design like a developer. Build like a designer.**

A local, agent-driven design canvas for React apps. Your coding agent redesigns
a real screen; you direct the work visually; the result goes back into your app.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-FFAB1F.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![npm](https://img.shields.io/npm/v/velloo.svg?color=FFAB1F)](https://www.npmjs.com/package/velloo)
[![CI](https://github.com/velloo-design/velloo/actions/workflows/ci.yml/badge.svg)](https://github.com/velloo-design/velloo/actions/workflows/ci.yml)
[![Discussions](https://img.shields.io/github/discussions/velloo-design/velloo?color=FFAB1F)](https://github.com/velloo-design/velloo/discussions)

[Quickstart](#quickstart) · [Documentation](./docs) · [Contributing](./CONTRIBUTING.md) · [Discussions](https://github.com/velloo-design/velloo/discussions) · [velloo.design](https://velloo.design)

</div>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./.github/assets/walkthrough-dark.gif">
    <img src="./.github/assets/walkthrough.gif" alt="A coding agent designs an approval inbox in Velloo: three directions, a refinement, canvas and Velloo Cloud comments it resolves, and the implemented screen" width="100%">
  </picture>
</p>

---

## What is Velloo?

You have a React screen that works and looks wrong. Redesigning it today means
rebuilding it somewhere it isn't — a Figma file, a throwaway prototype, a chat
window full of JSX you paste and repair.

Velloo puts the canvas next to your code instead. Your AI agent recreates the
screen as real components, explores alternatives, and checks its work visually
against the running app. You steer from the canvas: pick a direction, comment on
a frame, reject a variant. When a direction wins, the agent carries it back into
your application in your conventions.

Designs live beside your code as readable JSON, in your repo or in a separate
one. The whole loop is local and needs no account. When a review benefits from
other people, publish a board to a team workspace or send an external link;
comments come back to the local canvas for the agent to resolve.

**No Figma seats. No paste-ready JSX you babysit. No translation tax.**

> **Status:** early and moving fast. The design-folder format is versioned and
> migrated by `velloo upgrade`, but expect rough edges and breaking changes
> before 1.0. Bug reports and design feedback are very welcome.

## Quickstart

Install the CLI. The npm package pulls an exact official Bun platform binary
with no install scripts — you don't install or manage Bun yourself:

```bash
npm install -g velloo          # or: pnpm add -g velloo
```

Prefer a standalone install (macOS and Linux)?

```bash
curl -fsSL https://get.velloo.design/install.sh | bash
```

Then, from inside your app:

```bash
cd ~/code/my-shadcn-app
velloo init                    # interactive wizard
velloo run velloo              # the design folder it just created
```

- **Canvas** → http://localhost:7300
- **MCP server** (for your agent) → http://localhost:7301/mcp

Restart your agent so it picks up the new MCP config, then point it at a real
screen:

> "Open the `velloo` design folder, recreate `/settings/billing` on a new board,
> then show me three takes on the plan-comparison section."

That's the loop. The agent builds on the canvas, screenshots its own work, and
you react to pixels instead of to a diff.

### What `init` does

The wizard creates the design folder (default `velloo/`) and wires up your agent
— Claude Code, Cursor, Codex, Continue, opencode, Droid, Cline, Gemini CLI,
Windsurf, and VS Code/Copilot, each through its native MCP configuration and
guidance format. You can **start from scratch** (component library + a sample or
blank board) or **scan what you have**: scanning detects your shadcn and Tailwind
versions, imports your real theme from `globals.css`, and builds one screen per
route, so the canvas opens in your brand colors.

`init` never writes into your app's source. It only creates the design folder
and the agent config.

## Features

- **Existing-screen redesign.** Start from a React route or a captured
  authenticated page, recreate a faithful baseline, explore alternatives, and
  compare against the running product at the same viewport.
- **Real components, not approximations.** Components come from a
  `ComponentProvider`, so the design folder stays pure data. For shadcn,
  client-safe files from your app mount directly in the canvas; portal- and
  state-heavy families are explicitly adapted; compile failures fall back per
  component with diagnostics.
- **Five React adapters.** shadcn + Tailwind, Material UI, Ant Design, Chakra
  UI, and no-library React each render and emit through their own adapter.
- **Visual verification.** The agent inspects rendered nodes, takes screenshots,
  diffs against a live URL, and fixes what it sees instead of guessing from code.
- **Board → Screen → Frame.** One design folder holds many boards; frames that
  share a screen stay in sync, so a mobile and a desktop frame are one edit.
- **A real MCP surface.** Discovery, focused tree mutations, themes, screenshots,
  comparison, comments, and agent-consumed implementation IR — plus bundled
  skills for brand, design systems, logos, and design-to-code.
- **Optional collaboration.** Create a team, publish a board, share externally,
  and pull review comments back into the local canvas.

## Requirements

| | |
|---|---|
| **OS** | macOS (arm64, x64) and Linux (arm64, x64; glibc and musl). Windows via WSL. |
| **Runtime** | None to install — the CLI ships its own Bun. |
| **Your app** | React. shadcn + Tailwind gets the deepest integration; MUI, Ant Design, Chakra, and no-library folders are supported. |
| **Screenshots** | Optional headless Chromium, one command away (below). |

### Screenshots — the one optional extra

A headless Chromium is used for exactly two things: your agent's `screenshot`
tool (so it can *see* a design) and `velloo render <screen> --to=out.png`. The
canvas, editing, `publish`, `emit`, and everything else work without it. Install
it anytime (one-time, ~150 MB):

```bash
velloo browser install
```

If a screenshot ever fails, run exactly that command and retry.

## CLI essentials

Two files define the model: a repo-root **`velloo.json`** names each design
folder as a project (several can coexist in a monorepo), and
**`.design/config.json`** marks a directory as a design folder. Every
folder-taking command accepts a project name or a path, and resolves through
`velloo.json` when you pass nothing.

| Command | What it does |
|---|---|
| `velloo init` | Create a design folder and wire up your agent |
| `velloo run [folder]` | Start the canvas + MCP daemon (`--port` / `--mcp-port` if 7300/7301 are busy) |
| `velloo folder list\|add\|remove` | Manage the repo's design folders |
| `velloo emit` / `velloo render` | Implementation IR for your agent / a PNG of a screen |
| `velloo publish` | Publish a board for review (`--list`, `--remove`) |
| `velloo upgrade` | Update the install *and* migrate the folder format (`--check` to preview) |

`Ctrl-C` stops the server.

**Keeping designs out of the app repo** is a first-class option — pick "Default
out of repo" in the wizard, give a path outside the repo, or run
`velloo init --external --project web --non-interactive`. The design is recorded
only on your machine: nothing is written into the repo, the files live under
`~/.velloo/designs/` (or where you chose) outside version control, and agents are
wired through global configs. See
[Local designs outside the repository](./docs/external-local-design-folders.md).

**Choosing an MCP surface.** Velloo defaults to a compact progressive-disclosure
surface: the agent sees `call_velloo`, `run_velloo_plan`, and `operation_schema`
and pays for a native schema only when it needs one. Clients that do better with
conventional function schemas can use `velloo mcp --surface full`. Both surfaces
carry the whole operation catalogue. See [docs/mcp.md](./docs/mcp.md).

## Local-first by default

The local tool is free, complete, account-free, and telemetry-free.

The CLI makes exactly one anonymous request outside the solo loop: at most daily,
a detached check reads the public npm release version and caches it locally. It
sends no project or account data, and `VELLOO_DISABLE_UPDATE_CHECK=1` turns it
off. Everything else that touches the network is opt-in and gated behind an
explicit `velloo login`:

- `velloo login` / `velloo publish` — publish boards to a personal or team
  workspace and create external review links
- comment tools — read and resolve team and external-review feedback
- `generate_asset` — hosted image/SVG generation, metered against your credits
- `send_feedback` — agent-side product feedback, only when enabled in the folder
  config

You choose when — and whether — to use any of them.

## Documentation

| | |
|---|---|
| [docs/architecture.md](./docs/architecture.md) | Design-folder format, providers, renderer, codegen, canvas daemon |
| [docs/mcp.md](./docs/mcp.md) | The MCP tool surface agents talk to |
| [docs/providers.md](./docs/providers.md) | Adding a framework adapter |
| [docs/css-class-channel.md](./docs/css-class-channel.md) | How styling is routed per framework |
| [docs/external-local-design-folders.md](./docs/external-local-design-folders.md) | Local designs outside the repo: storage, agents, relocation, binding |

## Contributing

Contributions are welcome — bug reports, adapters, docs, and design feedback
alike. [`CONTRIBUTING.md`](./CONTRIBUTING.md) covers setup and the checks we
expect to be green; [`CLAUDE.md`](./CLAUDE.md) explains the repo's architecture
invariants before you change anything load-bearing.

The short version:

```bash
bun install                                 # also builds the snapshot manifest
bun run --cwd packages/canvas build         # build the canvas SPA
bun run velloo init /tmp/velloo-smoke
bun run velloo run /tmp/velloo-smoke        # canvas :7300, MCP :7301
bun run verify                              # typecheck + lint + knip + tests
```

Good first issues are labelled
[`good first issue`](https://github.com/velloo-design/velloo/labels/good%20first%20issue).

### Repo layout

Velloo is a Bun-workspaces monorepo with one-way dependencies:

| Package | Responsibility |
|---|---|
| `packages/schema` | Zod schemas + TS types for the on-disk design-folder format |
| `packages/protocol` | The wire contract: mutation arguments, typed errors, watch events |
| `packages/provider` | The `ComponentProvider` / `FrameworkAdapter` interface |
| `packages/provider-*` | shadcn, MUI, Ant Design, Chakra, and no-library adapters |
| `packages/shadcn-snapshot` | Pinned canvas-safe shadcn fallback, embedded in the binary |
| `packages/renderer` | Design JSON → HTML (and PNG via Playwright) |
| `packages/codegen` | Agent-consumed IR + theme emitters |
| `packages/server` | HTTP + MCP + mutations + theme + watcher |
| `packages/canvas` | Vite/React canvas UI |
| `packages/cli` | The `velloo` binary |

## Community and support

- **Questions, ideas, show-and-tell** →
  [Discussions](https://github.com/velloo-design/velloo/discussions)
- **Bugs and feature requests** →
  [open an issue](https://github.com/velloo-design/velloo/issues/new/choose)
- **Security issues** → [`SECURITY.md`](./SECURITY.md) — please don't file a
  public issue
- **Ground rules** → [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)

## License

Velloo is open source under the [Apache License 2.0](./LICENSE).

The **Velloo** name and the interlinked-frames mark are trademarks and are not
covered by the code license — fork the code freely, but don't ship a derivative
under the Velloo name or logo. See [`TRADEMARK.md`](./TRADEMARK.md).
