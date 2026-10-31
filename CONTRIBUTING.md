# Contributing to Velloo

Thanks for wanting to make Velloo better. This guide covers where to start,
setup, and the checks we expect to be green.

## Where to start

- **The [roadmap](https://github.com/orgs/velloo-design/projects/1)** lists
  what's planned, grouped into milestones. *Horizon* says roughly when: Now,
  Next or Later.
- **Issues labelled
  [`good first issue`](https://github.com/velloo-design/velloo/labels/good%20first%20issue)**
  are small and self-contained, and
  **[`help wanted`](https://github.com/velloo-design/velloo/labels/help%20wanted)**
  marks larger pieces that are ready for someone to pick up.
- **Comment on the issue before you start**, so two people don't build the same
  thing, and ask there if anything is unclear.
- **For a bigger change or a new idea**, start a
  [discussion](https://github.com/velloo-design/velloo/discussions/categories/ideas)
  first. Agreeing on the shape before the code saves everyone a rewrite.

## Find your way around

- [`AGENTS.md`](./AGENTS.md) — the package layout, the one-way dependency
  order and the architecture invariants. Read it before changing anything
  foundational; it is written for coding agents and people alike.
- [`docs/architecture.md`](./docs/architecture.md) — the design-folder format,
  the renderer, codegen and the canvas daemon.
- [`docs/providers.md`](./docs/providers.md) — adding a framework adapter or a
  recipe for a component library.
- [`docs/mcp.md`](./docs/mcp.md) — the operations an agent calls.

## Development setup

Velloo is a Bun workspaces monorepo, so you need [Bun](https://bun.sh) 1.4.3
— the version pinned by `packageManager` in [`package.json`](./package.json).

```bash
bun install                                    # also builds the snapshot manifest
bun run --cwd packages/canvas build            # build the canvas SPA
bun run velloo init /tmp/velloo-smoke
bun run velloo run /tmp/velloo-smoke           # canvas on :7300
```

The screenshot path needs Chromium once: `bun run velloo browser install`.

Optionally, let git run the same checks CI does — lint on commit, the full
`checks` job on push:

```bash
git config core.hooksPath .githooks
```

## Before you open a PR

Run these and make sure they pass:

```bash
bun run typecheck     # tsc -b, then tsconfig.scripts.json (scripts/, build.ts)
bun run lint          # biome check .
bun run lint:dead     # knip — unused files, exports, dependencies
bun run test          # bun test --parallel
```

`bun run verify` runs all of them, plus the MCP context budget, in one go.
`bun run lint:fix` and `bun run format` fix most style issues automatically.

Other ways to run the tests:

| Command | What it runs |
|---|---|
| `bun run test:changed` | Only the tests your diff touches — the fast inner loop |
| `bun run test:e2e` | The whole suite plus the Playwright suites |
| `bun run test:browser` | Only the Playwright suites (`*.e2e.test.ts`) |
| `bun run test:order` | The suite in random order, to catch order-dependent tests |
| `bun run mcp:budget` | Checks the MCP instructions and tools stay within their context budget |

Prefer `bun run test` over a bare `bun test`: the canvas DOM suites skip
themselves unless `--parallel` is on. To run a single DOM test file serially,
set `VELLOO_DOM_TESTS=1`.

After a change to the server, canvas, renderer or CLI, check it in the real
canvas too: build it, run a design, and try the change the way a person would.

## Pull requests

PR titles follow [Conventional Commits](https://www.conventionalcommits.org/):
`type(scope): description`, for example `fix(cli): keep canvases running through
a rename`. PRs are squash-merged, so the title becomes the commit on `main` and a
line in the release notes; the **PR title** check fails until it parses.

- **Types:** `feat`, `fix`, `perf`, `refactor`, `revert` appear in the release
  notes; `build`, `chore`, `ci`, `docs`, `style`, `test` are left out.
- **Breaking changes:** add `!` before the colon (`feat(cli)!: …`), or a
  `BREAKING CHANGE:` line in the PR description. Either puts the change under
  "Breaking changes" in the release notes.

- Keep PRs focused — one logical change per PR.
- Explain the what and the why; link an issue if there is one.
- Update `docs/` when behavior changes.
- Add or update tests for anything you change.

## License

By contributing, you agree that your contributions are licensed under the
Apache License 2.0, the same license that covers the project ([`LICENSE`](./LICENSE)).
