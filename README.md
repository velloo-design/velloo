<div align="center">

<img src=".github/assets/velloo-mark.svg" alt="Velloo" width="96" height="96">

# Velloo

**Design like a developer. Build like a designer.**

Design and code, finally the same shape.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-FFAB1F.svg)](https://www.apache.org/licenses/LICENSE-2.0)

</div>

---

Velloo is a **local-first, code-shaped design canvas**. Your AI agent does the design labor — composing screens from your real components and writing them into your app in your conventions — while you keep the taste and the calls. Designs live in your repo as JSON made of real components, not behind a seat in a vector tool you have to translate back into code.

No Figma seats. No paste-ready JSX you babysit. No translation tax.

See [`docs/`](./docs) for the architecture and the MCP reference.

## What it does

- **Board + Screen + Frame** mental model. A design folder hosts many boards; frames sharing a screen stay in sync.
- **Framework-native.** A folder targets a framework — shadcn (Tailwind `className`), MUI (`sx` + emotion, real `@mui/material`), or no-framework (bare primitives) — each rendered, styled, and emitted in its own idiom.
- **MCP surface for agents.** Discovery, tree mutations, screen / frame / board / snippet lifecycle, theme ops, inspect + dark-diff, screenshot + render_snippet, and an agent-consumed `emit_code` IR.
- **Pulse sample** ships with `velloo init` — three boards (Marketing + App + Playground), seven screens, with full dark-mode coverage.
- **Components come from a `ComponentProvider`.** The design folder is pure data (no `components/*.tsx`); customization happens through snippets.

## Local-first by default

The local tool is free, complete, account-free, and telemetry-free — nothing in the solo loop phones home. The only outbound calls are the optional, opt-in cloud commands (`velloo login`, `velloo publish`, feedback), and you choose when to make them.

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
