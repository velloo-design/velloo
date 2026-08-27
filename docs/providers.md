# Adding a framework provider

How to give Velloo a new UI framework (the way `provider-mui` did for Material UI). A
provider owns its framework end-to-end through the `FrameworkAdapter` interface
(`packages/provider/src/adapter.ts`); everything else in the system resolves the adapter
per screen and asks it. This document is the complete list of registration points —
if adding a framework requires touching anything not listed here, that's a bug in the
abstraction worth filing.

## The registration points

1. **The provider package** — `packages/provider-<x>` exporting `createProvider(): FrameworkAdapter`.
   Model on `packages/provider-mui` (the fullest example). Wire the root `tsconfig.json`
   project reference and respect the dependency chain (`provider` and `helpers` are
   upstream of you; nothing of yours is imported by them).
2. **The schema enum** — add the library id to `Library.id` in `packages/schema/src/config.ts`.
   Adding an id is backward-compatible (no `schemaVersion` bump); removing one is a
   format change that needs a migration in `packages/schema/src/migrate.ts`.
3. **The server factory** — one row in `createServerProviderLoader`
   (`packages/server/src/providers.ts`).
4. **The CLI wizard entry** — one entry in
   `packages/cli/src/wizard/provider-registry.ts` (label/hint, install plan, sample
   scaffold, styling-axis rule, scan mapping). `LibraryId`, the choice list, `--library`
   validation, and the handoff/readme text all derive from it.
5. **Scan detection (optional)** — if `velloo init --start=scan` should auto-detect the
   framework from the host's dependencies, move it from `detectUnsupportedUi` to the
   `uiLibrary` inference in `packages/cli/src/scan/detect.ts` and map it in the wizard
   entry's `scanMatch`.

## The adapter capabilities

Base `ComponentProvider` fields are required (id, version, componentsDir,
styleEntryPath, registry, loadManifest). Everything else is optional, but a
framework-native provider typically implements all of these:

- **`styleChannel` / `styleChannels`** — the native styling channel. If your framework's
  channel isn't `tailwind-classname` / `sx` / `style`, extend `StyleChannelKind`,
  `STYLE_CHANNELS`, and (if it's a folder-selectable CSS framework) `CSS_FRAMEWORK_CHANNEL`,
  and give the canvas a style-editor pane for it.
- **`registry`** — canvas-safe React components for design mode. The canvas-safe contract:
  no portals that escape the iframe, overlays render pinned-open and inline, no
  router/form requirements. Reuse the framework-neutral helpers via
  `helpersRegistry(ids)` from `@velloo/helpers` (Heading, Text, Icon, …).
- **`renderPass(theme, dark)`** — SSR wrapping + critical-CSS extraction when styles
  aren't Tailwind classes (MUI: emotion cache + ThemeProvider; cssinjs frameworks
  extract their own style sheet). Dark must project real dark values, not just a mode flag.
- **`themeToNative(theme, dark)` + `themeModule`** — the velloo token tree projected onto
  the framework's theme options, plus the module shape (`importLines`, `factory`,
  `defaultPath`) codegen's generic `emitNativeTheme` serializes. Values that must emit as
  bare identifiers (e.g. an algorithm reference) use `identifierRef("theme.darkAlgorithm")`;
  your `importLines` bring them into scope. No framework import ever appears in codegen.
- **`codegenModule`** — the bare module emitted component imports come from. Codegen's
  `CodegenTarget` remaps imports only: styling is authored in-channel at design time and
  serialized verbatim — there is deliberately no class→native translation at emit time.
- **`catalog()` / `installComponent(id, ctx)`** — the component catalog with real
  installed-status, and the per-component installer when components land in the user's
  app (shadcn-upstream shells out to the framework's own CLI; fully-bundled frameworks
  omit `installComponent` and report everything installed).
- **`canvasBundleSpec`** — how to bundle the host app's *actually installed* components
  for an exact-version client mount. `styleRuntime` is a discriminated union; `emotion`
  is implemented today — a new runtime kind means a new union member in
  `packages/provider/src/adapter.ts` plus a branch in the server's entry builder
  (`packages/server/src/live/canvas-bundle.ts`). Bundles are per-library: non-default
  screens mount their own.
- **`mcpIntro(channel)`** — the framing prepended to the MCP instructions. The base
  instruction text is shadcn/Tailwind-tuned; your intro tells the agent what's different
  (see `provider-mui/src/intro.ts` and `provider-none/src/intro.ts`).

## Host components are not providers

A component that exists only in the user's app is expressed with `$emitAs` on a
`ComponentNode` (`packages/schema/src/node.ts`): the canvas renders the primitive
approximation, codegen emits `<RealName />` with the recorded import path. Don't build a
provider for a single app's component set.

## What to test

Mirror `packages/server/src/__tests__/mui-render.test.ts`: an SSR render smoke over your
registry, theme projection asserting real light *and* dark values, `emit_code` producing
native idiom + imports from `codegenModule`, `emitNativeTheme` output, and overlay
canvas-safety (pinned open, no escaping portals). Add a framework-native task to the
model-evaluation harness for end-to-end agent validation.
