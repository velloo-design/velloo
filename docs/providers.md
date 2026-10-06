# Adding a framework provider

How to give Velloo a new UI framework (the way `provider-mui` did for Material UI). A
provider owns its framework end-to-end through the `FrameworkAdapter` interface
(`packages/provider/src/adapter.ts`); everything else in the system resolves the adapter
per screen and asks it. This document is the complete list of registration points —
if adding a framework requires touching anything not listed here, that's a bug in the
abstraction worth filing.

`provider-html` is the server-rendered example: no browser component bundle, no
Tailwind, and emission is native HTML rather than JSX. It gets there through two
capabilities below (`hostStylesheets`, `codegenFormat`) — nothing outside the provider
package, the factory row and the wizard entry knows its id.

## Which tier a framework belongs in

A library can arrive three ways, and most arrive without an adapter. **An adapter is
needed when the framework must render without a browser.** That is the criterion; use it
before writing a thousand lines.

Every surface that produces a picture already runs one. The canvas, `screenshot`,
`compare_to_url`, PNG and PDF export, `velloo render`, and publish's preview captures all
mount the screen in headless Chromium — through the daemon's routes, or through
`createCaptureMount` for a one-shot CLI that has no daemon behind it — so a repository
component (a recipe's library, or the app's own code) renders there for real, from the
app's own install. A recipe's job is to make that render faithful (its provider wrapper,
its stylesheet, its theme), not to make it possible.

What has no browser is the narrow part, and there a repository component falls back to its
proxy snippet or to a labelled dashed frame:

- plain SSR HTML — the screen-document route, and a `.html` export made without the
  headless browser. With it, the export mounts the screen in a capture page and keeps
  what the browser drew as scriptless markup, so the file holds the real components;
  without it the file is the server render and its warnings name what was stood in for;
- a share published without the headless browser. The cloud never executes app code, by
  design, so it cannot mount a repository component itself. Publish does it instead: each
  screen that uses one is mounted locally and its DOM ships in the bundle
  (`frozenScreens`), per theme and scheme a viewer can be shown, and the share viewer
  shows that markup rather than re-rendering the tree. The page photographed for a
  screen's preview is the page that is frozen, so the components mount once for both,
  and a stylesheet every frozen screen has — the compiled utilities, a component
  library's CSS — ships once and is named from each of them. The app's own stylesheet
  ships the same way (`appStylesheets`). A share is therefore the canvas's picture, and velloo-cloud's
  `share-parity` e2e holds it to that pixel for pixel. Only when publish had no browser
  to mount in does a viewer see frames, and publish says so.

So the cost of the recipe tier is worth stating plainly rather than discovering: **a
frozen screen is a picture of one viewport's DOM.** CSS still responds to the viewer's
frame size, but a component that picks its layout in JavaScript stays as it was at the
publish viewport. A framework whose folders must be re-rendered in the cloud, or
server-rendered where no browser is available, needs an adapter — that is what an
adapter buys, by SSR'ing the framework in-process. A framework that doesn't need that
already has its fidelity, and an adapter would buy it again for a thousand lines plus the
recurring upkeep of the six registration points below.

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
6. **Your entry CSS's own dependencies** — anything your `tailwind-entry.css`
   `@import`s by bare specifier must be a dependency of *your* package. The JIT
   resolves it from node_modules at runtime, out of the shipped
   `dist/pkgs/<you>/src`, so a package that is merely present in the workspace
   works from source and fails once installed — and because the compile is
   all-or-nothing, the symptom is every screen on the canvas rendering as a
   white box. The bundle derives its runtime dependencies from the stylesheets
   it copies (`packages/cli/src/css-imports.ts`), which is what keeps this from
   being something you have to remember.

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
  `helpersRegistry(ids)` from `@velloo/helpers` (Heading, Text, Prose, Icon, …). Always
  include `Prose`: `.typeset` is velloo-owned CSS shipped by `themeToCss` on every channel,
  so it works without any framework support.
- **`renderPass(theme, dark)`** — SSR wrapping + critical-CSS extraction when styles
  aren't Tailwind classes (MUI: emotion cache + ThemeProvider; cssinjs frameworks
  extract their own style sheet). Dark must project real dark values, not just a mode flag.
- **`themeToNative(theme, dark)` + `themeModule`** — the velloo token tree projected onto
  the framework's theme options, plus the module shape (`importLines`, `factory`,
  `defaultPath`) codegen's generic `emitNativeTheme` serializes. Values that must emit as
  bare identifiers (e.g. an algorithm reference) use `identifierRef("theme.darkAlgorithm")`;
  your `importLines` bring them into scope. No framework import ever appears in codegen.
  For typography, project `typesetScale(theme.typography.typesets?.[DEFAULT_TYPESET_NAME])`
  onto the framework's own type scale — not `fontFamily.sans` alone, and never a second
  copy of the ratios. `typesetScale` resolves to concrete numbers precisely because this
  object gets serialized into an artifact where no CSS variables exist; the canvas mount and
  the emitted theme both come through `themeToNative`, so they cannot disagree.
- **`codegenModule`** — the package your components import from. The server turns your
  manifest into a `CodegenTarget` (`codegenTargetFor`): every descriptor whose `source` is not
  `"velloo"` is a component you own, emitting under its own id — or under `nativeExport` when
  the real export is a dotted path a `$ref` cannot carry (antd's `TypographyTitle` ⇒
  `Typography.Title`) — and provisioned as `registryName` (a file the library installs) or
  this module (a package the app installs whole). You register nothing else: shadcn comes
  through the same resolver, so there is no default lowering path to opt out of. The target
  decides identifiers and provisioning only — styling is authored in-channel at design time
  and serialized verbatim, so there is deliberately no class→native translation at emit time.
- **`catalog()` / `installComponent(id, ctx)`** — the component catalog with real
  installed-status, and the per-component installer when components land in the user's
  app (shadcn-upstream shells out to the framework's own CLI; fully-bundled frameworks
  omit `installComponent` and report everything installed).
- **`canvasBundleSpec`** — ordered browser sources for the components referenced by one
  screen. Each source declares `exact`, `adapted`, or `fallback` fidelity; the server
  resolves and optionally preflight-compiles them independently, then builds one mixed
  registry. A broken host file therefore falls back without discarding exact neighbors.
  `styleRuntime` is a discriminated union (`none` and `emotion` today), and `sourceDirs()`
  names host directories that should invalidate the bundle and feed the Tailwind scan.
  Bundles are per-library and per referenced-component set: non-default screens mount
  their own without shipping an unused whole library.
- **`hostStylesheets: true`** — the design is styled by the app's own stylesheets
  (`hostApp.stylesheets`) rather than a CSS framework. Every render site resolves them
  through `hostStylesheetsForScreen`, and design documents link the copies the design
  keeps under `assets/host/`, served by the daemon under `/api/host-files`; a
  root-relative file a node names (`src="/static/logo.png"`) resolves there too.
  `store_host_files` fills those copies from the app's source or a capture, and publish
  ships them (`hostStylesheets` in the bundle). A design never reaches the running app:
  it looks the same to everyone who opens it.
- **`codegenFormat`** — `"html"` makes `emit_code`, `emit_snippet` and `velloo emit`
  return native markup (`emitHtml` in codegen) instead of JSX. Pair it with the inline
  `style` channel: `emit_theme` then writes the CSS custom properties the markup's
  `var(--…)` references need.
- **`mcpIntro(channel)`** — the framing prepended to the MCP instructions. The base
  instruction text is shadcn/Tailwind-tuned; your intro tells the agent what's different
  (see `provider-mui/src/intro.ts` and `provider-none/src/intro.ts`).

Descriptor metadata worth populating even though it's optional:

- **`group`** (a `COMPONENT_GROUPS` id) and **`family`** (the compound root, so
  `FieldLabel` ⇒ `Field`) are what make a large library browsable — they drive
  both the canvas Library shelves and `list_components`' default index. Omit
  them and your components still appear, in one undifferentiated bucket, which
  is fine for a curated few dozen and not for hundreds. Derive them from
  something structural (the shadcn snapshot keys off the vendored filename)
  rather than hand-listing ids: a hand-kept list is how 20 families once became
  unbrowsable without any test failing.
- **`designModeNotes`** should say when to reach for the component instead of
  building it from `Box` and `Text`. Skip it where the name is the whole story;
  spend it on anything compositional or newer than the models using it.

## The canvas fidelity ladder

`component_status` exposes the result for named components, or for exactly the components
one screen uses (`{ screen }`). Treat these statuses as a public contract, not an internal
implementation detail:

1. **Exact** — the selected module is the app's component source (or the exact installed
   package export for package-based adapters) and passed browser preflight. A Velloo
   helper or bare primitive is always exact, mounted from its source or drawn from its
   own server render: it has no app counterpart to stand in for, so it is never a
   fallback.
2. **Adapted** — a named canvas-safe implementation preserves the component vocabulary
   while changing interaction mechanics that conflict with a static selectable canvas,
   such as portals and menus that must remain open inline.
3. **Fallback** — a provider-owned source is rendering because the app
   file is absent or failed preflight. The diagnostic carries the chosen source and error.
4. **Unavailable** — no registered source can render. This does not cost the screen its
   mount: the ref is drawn from its own server render *inside* the mount
   (`static-fallback`), so nothing is hidden and every component that does have a source
   still renders for real beside it. The folder's extensions take the same path, declared
   static up front rather than discovered as failures, because Velloo has no
   implementation of an extension to put in a bundle; they report `code: "extension"`,
   which the canvas fidelity badge leaves alone. A screen whose components are all
   extensions has nothing to mount and keeps its server render, which is already the
   whole screen. Any other screen where nothing at all would mount keeps its server
   render too, but that one is a loss: `component_status { screen }` then reports
   `mounted: false` and `screenshot` / `compare_to_url` / `inspect { computed }` carry a
   `render/server-fallback` diagnostic.

Two more statuses exist for components that never reach a browser bundle at all:

5. **Server-rendered** — this adapter declares no `canvasBundleSpec`, so its components
   are what the server render produced. Say what that is and no more: an adapter whose
   manifest carries real library descriptors renders them from the library Velloo bundles,
   and an adapter of Velloo's own primitives (`none`, `html`) has no library behind it —
   never describe one as the other.
6. **Unchecked** — the adapter has a bundle but nothing here could build one, so no
   fidelity has been established. This is the absence of a verdict, not a verdict; report
   it rather than filling the gap with a confident default.

Note that an adapter having no `canvasBundleSpec` is not the same statement as "nothing
mounts in this folder". `CanvasBundler.canMount` mounts any screen that uses repository
components whatever the adapter declares, and every use of the spec in the build is
optional — so an antd or Chakra folder really does client-mount the app's own components.

Shadcn uses the first four outcomes. Ordinary client-safe `components/ui` files are exact,
compound children are preserved by the whole-screen interpreter, portal/state-heavy
families are adapted, and the embedded snapshot is a fail-safe fallback. MUI exact-mounts
installed package exports and keeps its existing canvas-safe overlay shims.

## App components and libraries without an adapter

Don't build a provider for a single app's component set, or for a library whose
components render fine from the app's own install. Both are **repository components**
(`docs/architecture.md`): discovered from what the app renders, placed as `$repo` nodes,
mounted for real inside the design's preview entry, emitted with their exact imports.
Declare `ownedModules` on an adapter so its own library isn't cataloged twice.

A popular library that needs more than the generic path gets a **recipe**, not an
adapter. The contract is `FrameworkRecipe` in `@velloo/provider`, beside `FrameworkAdapter`
— the two public tiers — and a whole recipe is one file: no schema library id, no loader
row, no wizard entry. Write it in `packages/server/src/repo/recipes/` and register it in
`recipes/index.ts`, which is where selection lives because it needs the host app's
`node_modules` (nothing in the contract itself touches the filesystem). It supplies

- `previewModule` — the default wrapper + stylesheet imports, resolved to the host's install;
- `themeToNative` / `themeModule` — Velloo tokens → the library's theme input (the preview
  entry receives it as `recipeTheme`, and `emit_theme` writes it as that library's own theme
  module);
- `adaptations` — design-time props per exact part (keep overlays in the frame);
- `styleProps` — the per-instance style props its components accept;
- `stylesheetProbe` — a DOM check that fails when the library's CSS isn't loaded, so an
  unstyled render is reported `unstyled`, never `exact`;
- `groups` / `notes` — Library shelves and agent framing.

A recipe is selected by what the host app resolves, never by which adapter the folder
sits on: a Mantine app in a MUI folder gets the Mantine recipe. Theme projection and
adaptations are per component *source*, so one screen can carry MUI nodes taking the
adapter's `createTheme` and Mantine nodes taking the recipe's — `emit_theme` writes both
modules (the second suffixed with its library, `theme-mantine.ts`), and a component's
adaptations come from its own host app's recipes.

Mantine is about 150 lines. **Untitled UI** was assessed against the same contract and needs
no recipe: it ships as copy-paste Tailwind v4 sources on `react-aria-components`, so its
components are already local repository components. Two known limits: its
react-aria overlays portal to `document.body` unless the preview entry wraps the app in
`UNSAFE_PortalProvider`, and its semantic Tailwind tokens compile only if the folder's
Tailwind JIT sees the app's own theme (`import_theme` from its `globals.css`).

`$emitAs` remains readable for old folders; a live extension (`render: "live"`) remains
the opt-in path for a dynamic leaf that can't render as a normal node.

## What to test

Mirror `packages/server/src/__tests__/mui-render.test.ts`: an SSR render smoke over your
registry, theme projection asserting real light *and* dark values, `emitNativeTheme` output,
and overlay canvas-safety (pinned open, no escaping portals). Add your framework to
`packages/server/src/__tests__/emit-frameworks.test.ts`, which asserts what each framework
emits through the production resolver on a real folder and holds every id its registry
renders to being emittable — the only shape that catches a lowering that quietly wins over
your components. Add a framework-native task to the end-to-end model-evaluation harness.
