# Framework demo boards

After generating them (below), run `velloo run` from this directory to start every demo — they're registered in
`demo-boards/velloo.json`, not the repo root's, so a bare `velloo run` at the root
starts only the product's own `velloo/` folder. Open just one with
`velloo run demo-mui` from here (or `demo-antd`, `demo-chakra`, `demo-none`,
`demo-shadcn-upstream`), or `velloo run .` inside its folder. Each folder contains
the same Elsewhere journey and agentic trip exploration boards, composed for its
own library.

These are runnable copies of the exact `velloo init` sample. They are generated,
not committed: run `bun scripts/refresh-demo-boards.ts` from the repo root once
after cloning, and again after editing the scaffold. Refresh overwrites
generated screens, snippets, boards, theme and assets, while preserving folder IDs.
