# Velloo

Code-shaped design tool for shadcn devs. Live local. Real shadcn components. AI-native MCP. Designs commit to your repo as JSON; theme exports as Tailwind config; pages export as shadcn JSX.

See [`docs/`](./docs) for the full design.

## Status

Pre-V0. Sprints 1–2 landed (schema + CLI scaffolding, headless shadcn renderer).

## Repo layout

- `packages/schema` — Zod schemas + TS types for the design folder format
- `packages/shadcn-snapshot` — pinned shadcn components + Tailwind v4 CSS + prop manifest
- `packages/renderer` — design JSON → HTML (and PNG via Playwright)
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
