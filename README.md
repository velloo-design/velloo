# Velloo

Local, code-shaped canvas for solo devs whose design team is an AI agent. Designs live in your repo as JSON, made of real shadcn components. Your agent reads them through MCP and writes the real code into your app.

See [`docs/`](./docs) for the full design.

## Status

Working substrate, used end-to-end. Sprints A → G are done. Highlights:

- **Board + Screen + Frame** mental model. Multi-board, frames sized freely on each board, sync between frames sharing a screen is implicit.
- **~50 MCP tools.** Discovery, tree mutations, screen / frame / board / snippet lifecycle, theme ops, inspect + dark-diff, screenshot + render_snippet, agent-consumed `emit_code` IR.
- **Pulse sample** ships with `velloo init` — 2 boards × 6 screens (landing, pricing, signup, dashboard, insights, settings), 3 snippets, 100% dark-mode coverage.
- **Components embedded** in `@velloo/shadcn-snapshot` — the design folder ships pure data (no `components/*.tsx`). Customization is via snippets.

See docs/roadmap.md for what's done and what's next.

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

Not yet released. License choice is deferred until first public release — see [docs/README.md](./docs/README.md). The current `LICENSE` file is a placeholder while the source is private.
