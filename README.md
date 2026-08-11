# Velloo

Code-shaped design tool for shadcn devs. Live local. Real shadcn components. AI-native MCP. Designs commit to your repo as JSON; theme exports as Tailwind config; pages export as shadcn JSX.

See [`docs/`](./docs) for the full design.

## Status

Pre-V0. Sprint 1 in progress (schema + CLI scaffolding).

## Repo layout

- `packages/schema` — Zod schemas + TS types for the design folder format
- `packages/cli` — `velloo` CLI (citty)

## Local dev

```bash
bun install
bun run typecheck
bun test
bun run velloo init /tmp/velloo-smoke
```

## License

Proprietary, all rights reserved. See [`LICENSE`](./LICENSE).
