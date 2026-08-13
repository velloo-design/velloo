# Velloo

Local, code-shaped canvas for solo devs whose design team is an AI agent. Designs live in your repo as JSON, made of real shadcn components. Your agent reads them through MCP and writes the real code into your app.

See [`docs/`](./docs) for the full design.

## Status

Working substrate, mid-revamp. Two near-term pivots reshape things:

- **Board + Screen + Frame** replaces pages + variants (see [docs/decisions.md](./docs/decisions.md) — the load-bearing mental-model change).
- **Library Registry** replaces the bundled `shadcn-snapshot` package — components move into the design folder at `velloo init`, owned by the user.

See [docs/roadmap.md](./docs/roadmap.md) for the live sprint plan.

## Repo layout

- `packages/schema` — Zod schemas + TS types for the design folder format
- `packages/shadcn-snapshot` — current bundled shadcn reference; **scheduled for removal** once the Library Registry lands (roadmap Sprint B–C)
- `packages/renderer` — design JSON → HTML (and PNG via Playwright)
- `packages/codegen` — agent-consumed IR + theme emitters
- `packages/server` — HTTP + MCP + mutations + theme + watcher
- `packages/canvas` — Vite/React canvas UI
- `packages/cli` — `velloo` CLI (citty)

## Local dev

```bash
bun install
bun --cwd packages/shadcn-snapshot run build    # build dist/styles.css + dist/manifest.json
bun run typecheck
bun test                                        # screenshot test gated on VELLOO_E2E=1
bun run velloo init /tmp/velloo-smoke
```

The Playwright screenshot path requires `bunx playwright install chromium` once.

## License

Not yet released. License choice is deferred until first public release — see [docs/README.md](./docs/README.md). The current `LICENSE` file is a placeholder while the source is private.
