# CLAUDE.md — repo-level guide for AI agents

This file orients you when you're modifying **the Velloo repo itself**. For guidance when you're touching a *Velloo design folder* via MCP, see the MCP server's `initialize` instructions; those concerns are separate from the substrate.

## Mental model

Velloo is a local, code-shaped design canvas for solo devs. The repo is a Bun-workspaces monorepo split into eight packages with one-way dependencies:

```
schema → result → renderer → codegen → shadcn-snapshot → server → canvas → cli
```

The cleanest packages (`schema`, `result`) have no internal deps. Everything else builds on them. **Do not introduce cycles** — every cross-package import must respect this order.

### Package responsibilities

- **`@velloo/schema`** — Zod schemas + TS types for everything on disk in a design folder (Screen, Board, Frame, Snippet, Theme, Config, Node, Annotation, CanvasNote). Plus pure utilities like `collectIds` / `findDuplicateIds`. **No I/O. No framework imports.** This package is the contract between every other package — keep it minimal.
- **`@velloo/result`** — `Result<T, E>` helpers (`ok`, `err`, `unwrap`, `Do`/`DoAsync` generator monads). Used throughout for typed errors instead of throwing.
- **`@velloo/renderer`** — Pure design JSON → React tree → HTML (server-render) + Playwright screenshot path. Includes the design-mode iframe runtime that talks to the canvas via MessageChannel.
- **`@velloo/codegen`** — `emit_code` (agent-consumed IR) + `emit_theme` (writes Tailwind v4 `globals.css` + `tailwind.config.ts` with diffs).
- **`@velloo/shadcn-snapshot`** — The pinned shadcn component snapshot Velloo ships with. Components are **embedded** here, not in user design folders.
- **`@velloo/server`** — HTTP + MCP + watcher + mutations + theme operations. Hono for routes, custom Bun-based static + WS server in `index.ts`.
- **`@velloo/canvas`** — Vite/React canvas SPA. Ships its own `src/components/ui/` (real shadcn — real Radix portals, Sonner toaster, working dialogs/popovers/etc.). The canvas only imports *types* (`Manifest`, `ComponentDescriptor`, `PropDescriptor`) from `@velloo/shadcn-snapshot`; their components are design-mode stubs not meant to drive live UI.
- **`@velloo/cli`** — `velloo` binary (citty). Subcommands: `init`, `run`, `emit`, `render`, `theme-export`, `upgrade`.

## Important architecture invariants

1. **Components are embedded, not on disk in design folders.** Pre-pivot Velloo wrote `components/*.tsx` into every design folder. Now the snapshot is embedded in `@velloo/shadcn-snapshot` and the design folder ships pure data. **Do not** reintroduce on-disk components for user folders. See `docs/decisions.md` #4 + #17.
2. **Two copies of shadcn, one upstream pull.** `@velloo/shadcn-snapshot` is the design-mode-only fork (overlays inline-stubbed via `canvas-portal.tsx`, Calendar/Chart/Carousel are static fakes). `@velloo/canvas/src/components/ui/` is the real shadcn for the IDE chrome. They re-vendor from the same upstream pull on the same day and the snapshot's `snapshotVersion` records it. See `docs/decisions.md` #18.
3. **Customization happens through snippets, not custom components.** Users who want a custom Button wrap the snapshot's Button in a snippet. No dynamic component loading.
4. **Designs are static.** Click handlers, routing, form state — all no-ops in the canvas. The renderer's iframe runtime intercepts clicks for selection only.
5. **Board → Frame → Screen, not Pages → Variants.** A screen has one tree; viewport size is a property of the frame *placement*. Different viewports of the same screen are multiple frames pointing at the same screen (edits sync). Different layouts per breakpoint are separate screens.
6. **Every mutation returns `Result<T, MutationError>`.** Don't throw across mutation boundaries. Look in `packages/server/src/mutations/errors.ts` for the error variants.

## Where things live

- **Mutations** — `packages/server/src/mutations/<verb>.ts` for implementations; `packages/server/src/mutations/api/<area>.ts` for the orchestration wrappers (lock + impl); `packages/server/src/mutations/index.ts` re-exports.
- **MCP tools** — `packages/server/src/mcp/tools/<area>.ts`. The instructions string lives in `packages/server/src/mcp/server.ts` (around `INSTRUCTIONS`).
- **Canvas state** — single Zustand slice in `packages/canvas/src/store.ts`. Convenience namespaced hooks (`useSelection`, `useViewport`, etc.) in `store-hooks.ts`.
- **Canvas HTTP surface** — `packages/canvas/src/api/<area>.ts`, re-exported from `packages/canvas/src/api.ts`.
- **Renderer iframe runtime** — `packages/renderer/src/iframe-runtime.ts` (the script injected into design iframes). Pair with `packages/canvas/src/iframe-channel.ts` (parent side).
- **Decisions** — `docs/decisions.md` is the source of truth for architecture. If you're about to change something fundamental, read it first.

## Conventions

- **TS strict.** No `any`. Use `unknown` at trust boundaries (JSON.parse, postMessage, DOM events).
- **Biome** for lint+format. Run `bun run lint:fix` before committing.
- **Tests with `bun test`.** Tests live alongside source in `__tests__/`. Schema package tests run fast; theme integration tests scaffold a tmp folder. Don't mock the filesystem — use `tmpdir()`.
- **No `console.log` in shipped code.** The CLI prints user-facing output; the server uses `console.error` for unexpected failures. Anything else is debugging cruft.
- **Comments document the non-obvious only.** WHY, not WHAT. No comments on well-named identifiers, no PR-reference comments, no "added for X" notes.

## Common pitfalls

- **Don't add to `@velloo/shadcn-snapshot` casually.** Every new component must pass the canvas-safe contract (no portals that escape, no router-required behavior, stub providers for design mode). Manifests need explicit prop categorization.
- **Don't import snapshot components for canvas chrome.** Their overlays are pinned-open inline stubs by design. Use the canvas's own `@/components/ui/*` (real shadcn) instead.
- **Don't introduce optional fields in `@velloo/schema` without thinking about persistence.** Every Zod field is part of the on-disk contract. Adding a required field is a breaking change for existing design folders.
- **Don't read a folder's `screens/` or `boards/` directly.** Use `loadDesignFolder` (server) or the design-folder structure returned by it.
- **Don't touch a screen tree from outside the mutation layer.** Every modification goes through `withScreenLock`. Direct mutation breaks the watcher invariant and may corrupt history.

## Validating changes

Before considering anything done:

```bash
bun run typecheck    # tsc -b across the workspace
bun run lint         # biome check .
bun test             # ~130 tests, ~1s
```

The CLI test (`packages/cli/src/__tests__/init.test.ts`) spawns `velloo init` as a subprocess — it's the only test that exercises the full surface and the canary for onboarding breakage.

## Where to read more

- `docs/architecture.md` — full runtime architecture.
- `docs/decisions.md` — every load-bearing decision with reasoning.
- `docs/mcp.md` — MCP tool catalogue + handshake.
- `docs/roadmap.md` — what's done, what's next.
- `docs/product.md` — product framing.
