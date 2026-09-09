# Framework demo boards

Run `velloo run` from the repository root to start all registered design folders.
Open just one with `velloo run demo-mui` (or `demo-antd`, `demo-chakra`,
`demo-none`, `demo-shadcn-upstream`). Each folder contains the same Elsewhere
journey and agentic trip exploration boards, composed for its own library.

These are runnable copies of the exact `velloo init` sample. Refresh them with
`bun scripts/refresh-demo-boards.ts` after editing the scaffold. Refresh overwrites
generated screens, snippets, boards, theme and assets, while preserving folder IDs.
The original canvas-authored shadcn design remains in `initial-board/`.
