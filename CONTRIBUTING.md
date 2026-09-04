# Contributing to Velloo

Thanks for wanting to make Velloo better. This guide covers setup and the
checks we expect to be green.

## Development setup

Velloo is a Bun workspaces monorepo, so you need [Bun](https://bun.sh).

```bash
bun install
bun --cwd packages/shadcn-snapshot run build   # build dist/manifest.json
bun --cwd packages/canvas run build            # build the canvas SPA
bun run velloo init /tmp/velloo-smoke
bun run velloo run /tmp/velloo-smoke           # canvas :7300, MCP :7301
```

The screenshot path needs Chromium once: `velloo browser install`.

## Before you open a PR

Run these and make sure they pass:

```bash
bun run typecheck     # tsc -b
bun run lint          # biome check .
bun test
```

`bun run lint:fix` and `bun run format` fix most style issues automatically.

## Pull requests

- Keep PRs focused — one logical change per PR.
- Explain the what and the why; link an issue if there is one.
- Update `docs/` when behavior changes.
- Add or update tests for anything you change.

## License

By contributing, you agree that your contributions are licensed under the
Apache License 2.0, the same license that covers the project ([`LICENSE`](./LICENSE)).
