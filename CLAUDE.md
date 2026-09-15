# CLAUDE.md — repo-level guide for AI agents

This file orients you when you're modifying **the Velloo repo itself**. For guidance when you're touching a *Velloo design folder* via MCP, see the MCP server's `initialize` instructions; those concerns are separate from the substrate.

## Mental model

Velloo is a local, code-shaped design canvas for solo devs. The repo is a Bun-workspaces monorepo split into sixteen packages with one-way dependencies:

```
schema → result → protocol → provider → helpers → shadcn-snapshot → provider-none, provider-mui, provider-shadcn-upstream, provider-antd, provider-chakra → renderer → codegen → server → canvas → cli
```

`protocol` is the wire contract (mutation arguments, typed errors, watch
events, the cloud surface, the publish bundle) — imported by `server`,
`canvas`, `cli`, and by velloo-cloud.

The cleanest packages (`schema`, `result`, `provider`) have no internal runtime deps. Everything else builds on them. **Do not introduce cycles** — every cross-package import must respect this order.

**Velloo is framework-native.** A folder *targets a framework*: shadcn (Tailwind `className`), MUI (`sx` + emotion, real `@mui/material`), or no-framework (bare primitives). The `ComponentProvider` grew into a **`FrameworkAdapter`** (`packages/provider/src/adapter.ts`) owning the style channel, render pass, codegen module, theme projection, catalog/install, and the canvas bundle. So: styling is **not** universally Tailwind (`set_style` routes through `styleChannelOf(provider, folderCss)`); codegen emits the screen framework's native idiom (a `CodegenTarget`); and the canvas bundle can mix exact host files, canvas-safe adaptations, and fallbacks in one screen. When you touch styling, rendering, codegen, or the inspector, resolve the **per-screen adapter** (`providerForScreen`) and its `StyleChannel` — never assume shadcn/Tailwind.

**The CSS framework is its own axis, independent of the UI library.** `config.styling.framework` (`"tailwind"` | `"none"`, detected by `init`) picks the channel for a provider that supports more than one: shadcn is always Tailwind and MUI always `sx` (intrinsic, single-channel), but **no-framework** pairs with Tailwind *or* `none` (inline `style` objects, no JIT — themed via the CSS vars `themeToCss` injects). So a `none/none` folder renders inline-styled primitives (`provider.registryForChannel("style")`), the inspector edits an inline `style` object, and `emit_code` produces Tailwind-free `style={{…}}` on plain HTML. `styleChannelOf(provider, folderCss)` is the one resolver; the provider's `styleChannels` allowed-set bounds what `folderCss` can pick, and `resolveProviders` rejects an incoherent pair (shadcn + none).

### Package responsibilities

- **`@velloo/schema`** — Zod schemas + TS types for everything on disk in a design folder (Screen, Board, Frame, Snippet, Theme, Config, Node, Annotation, CanvasNote). Plus pure utilities like `collectIds` / `findDuplicateIds`. **No I/O. No framework imports.** This package is the contract between every other package — keep it minimal.
- **`@velloo/result`** — `Result<T, E>` helpers (`ok`, `err`, `unwrap`, the `DoAsync` generator monad). Used throughout for typed errors instead of throwing.
- **`@velloo/provider`** — The `ComponentProvider` interface every library entry implements (shadcn, no-lib, MUI, future host-scan). Owns the `Manifest` / `ComponentDescriptor` / `PropDescriptor` types. No runtime code beyond the loader plumbing — concrete providers live in their own packages.
- **`@velloo/helpers`** — The framework-neutral velloo helper components (Box, Heading, Text, Icon, Image, SVG, Layer, Divider, Gradient, Placeholder) plus their canonical `ComponentDescriptor` set (`HELPER_DESCRIPTORS` / `helperDescriptors(ids)`), the `helpersRegistry(ids)` subset selector every provider reuses, the codegen lowering class tables (`src/lowering.ts`), and `helpersComponentsDir` (the Tailwind JIT scans it so helper default classes always compile). Sits between `provider` and the concrete providers; no library idioms.
- **`@velloo/shadcn-snapshot`** — **Internal**: the canvas design-mode runtime that `provider-shadcn-upstream` reuses — not a user-facing provider since format v2 (its internal `id: "shadcn-react"` is a self-identity string only; the config shim migrates old folders to `shadcn-upstream`). Hand-vendored canvas-safe shadcn sources, the Tailwind entry CSS, and the generated `dist/manifest.json` (its `build.ts` ts-morph-extracts the shadcn descriptors and splices in the helpers' canonical ones).
- **`@velloo/provider-shadcn-upstream`** — The default shadcn adapter. SSR uses the embedded snapshot as a fail-safe; the browser canvas builds a mixed per-screen registry that imports client-safe app files exactly, uses explicit snapshot adaptations for portal/state-heavy families, and falls back independently when a file is absent or fails preflight. It enriches common host CVA variants/props into the manifest, watches the configured source directory, and exposes fidelity through `component_status`.
- **`@velloo/provider-none`** — The no-library provider. Six bare primitives (Box, Stack, Container, Card, Button, Input) wrapping plain HTML, plus the reusable velloo helpers (Heading, Text, Icon, …) re-used from `@velloo/helpers`. The only provider with a **CSS-framework choice**: `styleChannels: ["tailwind-classname", "style"]`. A `none/tailwind` folder uses the Tailwind-classed `registry`; a `none/none` folder uses the inline-styled `registry-inline.ts` (`registryForChannel("style")` — `components-inline.tsx`, structural defaults as `style` objects via `var(--…)` theme vars, no JIT). The trivial-end proof the abstraction works *and* that styling is a separate axis.
- **`@velloo/provider-mui`** — Material UI v6 provider, a full **`FrameworkAdapter`**. Real `@mui/material` components SSR'd in-process with emotion critical CSS (`renderPass`); `sx` style channel; the velloo token tree projects onto a MUI theme (`muiThemeOptions`, oklch→rgb via culori, also serialized to a `createTheme()` codegen artifact); canvas-safe overlay shims (Dialog/Menu/Popover/Drawer/Snackbar, rendered open + inline); `codegenModule`/`themeToNative`/`catalog`/`canvasBundleSpec` for native codegen, theme emit, install, and the per-folder installed-component canvas bundle. MUI + emotion + culori are pre-bundled velloo deps pinned to the monorepo React.
- **`@velloo/renderer`** — Pure design JSON → React tree → HTML (server-render) + Playwright screenshot path. Provider-agnostic: the registry is supplied through `BuildTreeOptions` / `RenderOptions`, not imported. Includes the design-mode iframe runtime that talks to the canvas via MessageChannel.
- **`@velloo/codegen`** — `emit_code` (agent-consumed IR) + `emit_theme` (writes Tailwind v4 `globals.css` + `tailwind.config.ts` with diffs).
- **`@velloo/server`** — HTTP + MCP + watcher + mutations + theme operations. Hono for routes, custom Bun-based static + WS server in `index.ts`. Resolves the active provider at boot via `packages/server/src/providers.ts` (knows about `shadcn-upstream`, `none`, `mui`); `MutationContext` carries the resolved instance.
- **`@velloo/canvas`** — Vite/React canvas SPA. Ships its own `src/components/ui/` (real shadcn — real Radix portals, Sonner toaster, working dialogs/popovers/etc.). Provider types (`Manifest`, `ComponentDescriptor`, `PropDescriptor`) come from `@velloo/provider`; the iframe message contract (`ParentMessage`, `ChildMessage`, `PROTOCOL_VERSION`) from `@velloo/renderer/iframe-protocol`. The canvas has **no** `@velloo/shadcn-snapshot` (or `@velloo/helpers`) dependency — never reintroduce one.
- **`@velloo/cli`** — `velloo` binary (citty). Subcommands: `init`, `run`, `folder`, `mcp`, `stop`, `status`, `connect`, `login`, `logout`, `publish`, `emit`, `render`, `capture`, `browser`, `export`, `upgrade`, `theme:export`, `completions` (plus the env-gated `trace`). Verbs consolidate onto their noun rather than spreading across the top level: `publish --list` / `--remove` replaced `published` / `unpublish`, and `folder list|add|remove` manages the repo's design folders (`folder add` is `runInit` with the path pre-chosen). The lazy subcommand table lives in `commands/registry.ts` — shared by `cli.ts` and the shell-completions generator (`completions/`), which introspects the citty defs so completions never drift. `init` is interactive (clack-driven wizard); the `wizard/` module composes the prompts and the `scan/` module produces screens from a host app's route structure. Folder resolution (`folder.ts`) consults a repo-root `velloo.json` manifest (`manifest.ts`) when present — a monorepo's design folders as named projects, registered by `init`; design folders as named projects plus the handful of repo-level preferences (feedback consent), never per-folder design config. Its entries are only ever paths *inside* the repo: a design folder outside the checkout (managed storage or a chosen path) is a **local design**, recorded solely in `~/.velloo/designs/.locations/` (`packages/server/src/project-location.ts`) and merged in by `findProjects`. Never write a local design into `velloo.json` or into the checkout (no project agent configs, no guidance files) — a cloned repo must not be able to point Velloo outside itself.

## Important architecture invariants

1. **Components come from a `ComponentProvider`, not from a direct snapshot import.** Every consumer reads through the `ComponentProvider` interface (`@velloo/provider`) and the server resolves one provider instance per *library* per folder: `ctx.providers` is a map keyed by library id, and `providerForScreen(ctx, screen)` / `registryForScreen(ctx, screen)` pick the right one per render. **Do not** import from `@velloo/shadcn-snapshot` outside the `providers.ts` factory registration or test fixtures. **Do not** reintroduce on-disk components for user folders. **Do not** read `ctx.provider` at render call sites — use `registryForScreen` so the right library + extensions are merged.
2. **Two copies of shadcn, one upstream pull.** `@velloo/shadcn-snapshot` is the design-mode-only fork (`vendor.ts` pulls the registry; its `ADAPTED` set names the components that can't be taken verbatim — overlays inline-stubbed via `canvas-portal.tsx`, controlled-without-a-handler props promoted to their uncontrolled form, and Chart kept on echarts because recharts renders nothing under static SSR); `@velloo/canvas/src/components/ui/` is the real shadcn for the IDE chrome, with its **own** `vendor.ts` (a `COMPONENTS` catalog of what the chrome reaches for, `registryDependencies` resolved transitively, and a component whose npm deps aren't installed skipped rather than written — which is why `calendar`/`command` aren't there). Its `ADAPTED` set should stay near-empty: unlike the snapshot's, a divergence here is an a11y fix upstream hasn't taken, not a contract. **Both copies must be on the same style + CLI pin**, and `packages/canvas/src/__tests__/vendored-ui.test.ts` now asserts it — nothing did before, and the copies silently drifted a full style apart (snapshot at radix-nova/55, chrome left on new-york/21, so every family the 2026.09 pull added was unavailable to the product). Framework-native rendering uses *real components, one source per framework* — MUI SSRs its actual `@mui/material` in-process (no fork), and when the host framework is installed the canvas client-mounts the exact `node_modules` build (`packages/server/src/live/canvas-bundle.ts`).
3. **Use the fidelity ladder intentionally.** Repo-backed library components render exactly when browser-safe; static-canvas conflicts use named adaptations; compile/missing cases use visible, diagnosed fallbacks. Snippets are still the editable composition layer for app-specific patterns, `$emitAs` preserves an external component identity when preview is approximate, and **live islands** remain opt-in for dynamic leaf components such as charts — never the default library path.
4. **Designs are mostly static.** Click handlers, routing, form state — all no-ops in the canvas; the renderer's iframe runtime intercepts clicks for selection only. The exception is **live-island** nodes, which run real client React for a faithful preview — but their mount keeps `pointer-events: none`, so selection still wins (visual-only).
5. **Board → Frame → Screen, not Pages → Variants.** A screen has one tree; viewport size is a property of the frame *placement*. Different viewports of the same screen are multiple frames pointing at the same screen (edits sync). Different layouts per breakpoint are separate screens.
6. **Every mutation returns `Result<T, MutationError>`.** Don't throw across mutation boundaries. Look in `packages/server/src/mutations/errors.ts` for the error variants.

## Where things live

- **Mutations** — `packages/server/src/mutations/<verb>.ts` for implementations; `packages/server/src/mutations/api/<area>.ts` for the orchestration wrappers (lock + impl); `packages/server/src/mutations/index.ts` re-exports. Extension lifecycle (`addExtension` / `updateExtension` / `removeExtension`) lives at `packages/server/src/mutations/extensions.ts`.
- **MCP tools** — `packages/server/src/mcp/tools/<area>.ts`. The instructions string lives in `packages/server/src/mcp/server.ts` (around `INSTRUCTIONS`).
- **Provider plumbing** — `packages/provider/src/` for the interface + loader. `packages/server/src/providers.ts` for the server-side factory registration + migration shims (`migrateLibrarySource`, `migrateConfig`, `resolveProviders`). Concrete providers live in their own packages.
- **Extensions** — `packages/server/src/extensions/registry.ts` for the per-screen registry composer (library + extensions, with shadowing). `packages/server/src/extensions/placeholder.tsx` for the canvas Tier-1 render. Schema lives in `packages/schema/src/extension.ts`.
- **Component browsing metadata** — `COMPONENT_GROUPS` (the shelf vocabulary) in `packages/provider/src/manifest.ts`; the shadcn family→shelf table in `packages/shadcn-snapshot/src/groups.ts` and its usage notes in `src/notes.ts`, both merged into the manifest by `build.ts`. Descriptors carry `group` + `family`, and those two fields drive *both* the canvas Library shelves (`packages/canvas/src/library-categories.ts`) and `list_components`' default index. **Never re-introduce a hand-written list of component ids for browsing** — that is exactly how the 2026.09 refresh left 20 new families unreachable in the UI with nothing failing.
- **Canvas state** — one Zustand store composed from feature-grouped slices in `packages/canvas/src/store/` (design / selection / viewport / modes / inspector / library / annotations). Consumers import `useCanvas` from `packages/canvas/src/store.ts`.
- **Canvas HTTP surface** — `packages/canvas/src/api/<area>.ts`, re-exported from `packages/canvas/src/api.ts`.
- **Renderer iframe runtime** — `packages/renderer/src/iframe-runtime.ts` (the script injected into design iframes). Pair with `packages/canvas/src/iframe-channel.ts` (parent side).

## Conventions

- **TS strict.** No `any`. Use `unknown` at trust boundaries (JSON.parse, postMessage, DOM events).
- **Biome** for lint+format. Run `bun run lint:fix` before committing.
- **Tests with `bun test`.** Tests live alongside source in `__tests__/`. Schema package tests run fast; theme integration tests scaffold a tmp folder. Don't mock the filesystem — use `tmpdir()`.
- **Scaffold design folders through `@velloo/server/testing`** (`packages/server/src/testing/design-folder.ts`) — `designConfig` / `designTheme` for the literals, `scaffoldDesignFolder` / `testContext` for a folder on disk plus a `MutationContext` that records broadcasts. Don't hand-roll another config literal; the point is that a schema change lands in one place.
- **Canvas component tests that need a DOM** import `./dom.ts` (`packages/canvas/src/__tests__/dom.ts`) and wrap their suites in `domSuite`. Load the component under test with `await import()` after that — react-dom binds the DOM globals at module init, and a static import gets sorted above the registration.
- **No `console.log` in shipped code.** The CLI prints user-facing output; the server uses `console.error` for unexpected failures. Anything else is debugging cruft.
- **Comments document the non-obvious only.** WHY, not WHAT. No comments on well-named identifiers, no PR-reference comments, no "added for X" notes.

## Common pitfalls

- **Don't add to `@velloo/shadcn-snapshot` casually.** Every new component must pass the canvas-safe contract (no portals that escape, no router-required behavior, stub providers for design mode). Manifests need explicit prop categorization, and a new family needs a shelf in `src/groups.ts` (the manifest test fails otherwise) plus a usage note in `src/notes.ts` if an agent would otherwise rebuild it from `Box` and `Text`.
- **Don't import snapshot components for canvas chrome.** Their overlays are pinned-open inline stubs by design. Use the canvas's own `@/components/ui/*` (real shadcn) instead.
- **The chrome takes its own advice: reach for a family, don't hand-roll one.** The MCP instructions tell agents that a labelled input is `Field`, a search box is `InputGroup`, a "nothing here" panel is `Empty`, joined buttons are `ButtonGroup` — and the canvas is held to the same rule. Before writing a centered-muted-text div, a `relative`-plus-`absolute`-magnifier pair, a `<kbd>` class string or a grid with an inline `gridTemplateColumns`, check `src/components/ui/` for the family that already is it. The five drifting copies of the empty state that `EmptyState.tsx` now replaces are what not doing this looks like after a year.
- **After a `bun run vendor`, expect classes upstream emits but doesn't ship.** The registry's sources reference `cn-*` semantic classes (`cn-menu-translucent`, `cn-font-heading`, `cn-calendar-*`) that live in the shadcn.com app's own `globals.css` and are not distributed with the item — the same leak that puts `IconPlaceholder` in the source. An undefined one renders *inert*, not broken, so define it in the package's entry stylesheet to upstream's intent; the stylesheet tests in both packages fail on one that isn't. Note that a bare `@utility` loses to the `bg-popover` sitting beside it on the same element, hence the doubled selector on `cn-menu-translucent`.
- **Don't introduce optional fields in `@velloo/schema` without thinking about persistence.** Every Zod field is part of the on-disk contract. Adding a required field is a breaking change for existing design folders.
- **Don't read a folder's `screens/` or `boards/` directly.** Use `loadDesignFolder` (server) or the design-folder structure returned by it.
- **Don't touch a screen tree from outside the mutation layer.** Every modification goes through `withScreenLock`. Direct mutation breaks the watcher invariant and may corrupt history.

## Validating changes

Before considering anything done:

```bash
bun run typecheck    # tsc -b across the workspace + tsconfig.scripts.json
bun run lint         # biome check .
bun run lint:dead    # knip — unused files, exports, dependencies
bun run mcp:budget   # MCP boot context stays within the guided/full budgets
bun test             # ~2500 tests across ~240 files, ~20s (--parallel)
```

`lint:dead` is expected to print nothing. If an export is only reachable from
velloo-cloud (its share viewer sibling-imports a few browser-safe modules by
path), add it to that package's `entry` list in `knip.jsonc` — don't delete it,
and don't let the report grow a permanent baseline.

Other test entry points: `bun run test:changed` (only what your diff touches — the
fast inner loop), `bun run test:order` (`--randomize`, catches tests that only pass
in declaration order), and `bun run test:e2e` (`VELLOO_E2E=1`, adds the Playwright
suites). `bun run codeql` runs GitHub's code-scanning suite locally (~30s; needs
`brew install --cask codeql`) and hides findings already dismissed on GitHub. CI runs `test:e2e` in its own job, under a virtual display and the full
Chromium build — the capture-session suite drives a *headed* browser, which the
`--only-shell` install `velloo browser install` uses cannot open.

The repo's hooks (`.githooks/`, enabled with `git config core.hooksPath .githooks`)
run this list for you: `pre-commit` runs the lint, and
`pre-push` runs the whole `checks` job — typecheck, lint, knip, the MCP context
budget, the canvas build, and the suite under `--randomize`. Either can be skipped for one
invocation with `--no-verify`.

Prefer `bun run test` over a bare `bun test`: the canvas DOM suites need one
global per file, so they skip themselves unless `--parallel` is on. Running a
single DOM file serially wants `VELLOO_DOM_TESTS=1`.

The CLI test (`packages/cli/src/__tests__/init.test.ts`) spawns `velloo init` as a subprocess — it's the only test that exercises the full surface and the canary for onboarding breakage.

## Where to read more

- `docs/architecture.md` — full runtime architecture: design-folder format, providers/adapters, renderer, codegen, the canvas daemon.
- `docs/providers.md` — adding a framework provider: every registration point, the adapter capabilities, the canvas-safe contract.
- `docs/mcp.md` — MCP tool catalogue + handshake.
