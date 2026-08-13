# Velloo

Code-shaped design tool for shadcn devs. Live local. Real shadcn components. AI-native MCP. Designs commit to your repo as JSON; theme exports as Tailwind config; pages export as shadcn JSX.

See [`docs/`](./docs) for the full design.

## Status

Working substrate; building toward continuous usefulness sprint over sprint (see docs/roadmap.md for the live plan). No "V0 launch" milestone.

## Repo layout

- `packages/schema` — Zod schemas + TS types for the design folder format
- `packages/shadcn-snapshot` — current bundled shadcn reference; being replaced by the Library Registry (init pulls components into the design folder; see roadmap Sprint A)
- `packages/renderer` — design JSON → HTML (and PNG via Playwright)
- `packages/codegen` — page + theme emitters
- `packages/server` — HTTP + MCP + mutations + theme + watcher
- `packages/canvas` — Vite/React canvas UI
- `packages/cli` — `velloo` CLI (citty)

## Local dev

```bash
bun install
bun --cwd packages/shadcn-snapshot run build    # build dist/styles.css + dist/manifest.json
bun run typecheck
bun test                                        # 25 tests; screenshot test gated on VELLOO_E2E=1
bun run velloo init /tmp/velloo-smoke
bun run velloo render /tmp/velloo-smoke/pages/onboarding.json --variant mobile --to /tmp/velloo-smoke.html
```

The Playwright screenshot path requires `bunx playwright install chromium` once. To run the e2e screenshot test: `VELLOO_E2E=1 bun test`.

## License

Proprietary, all rights reserved. See [`LICENSE`](./LICENSE).
