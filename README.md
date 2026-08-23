# Velloo

Local, code-shaped canvas for solo devs whose design team is an AI agent. Designs live in your repo as JSON, made of real components. Your agent reads them through MCP and writes the real code into your app.

See [`docs/`](./docs) for the architecture and MCP reference.

## What it does

- **Board + Screen + Frame** mental model. A design folder hosts many boards; frames sharing a screen stay in sync.
- **Framework-native.** A folder targets a framework — shadcn (Tailwind `className`), MUI (`sx` + emotion, real `@mui/material`), or no-framework (bare primitives) — each rendered, styled, and emitted in its own idiom.
- **MCP surface for agents.** Discovery, tree mutations, screen / frame / board / snippet lifecycle, theme ops, inspect + dark-diff, screenshot + render_snippet, and an agent-consumed `emit_code` IR.
- **Pulse sample** ships with `velloo init` — three boards (Marketing + App + Playground), seven screens, with full dark-mode coverage.
- **Components come from a `ComponentProvider`.** The design folder is pure data (no `components/*.tsx`); customization happens through snippets.

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

Not yet released. The license choice is deferred until the first public release; the current `LICENSE` file is a placeholder while the source is private.
