# @velloo/provider

The framework-adapter abstraction every Velloo library entry implements.

The base `ComponentProvider` says: "here are my React components, here's where
their source files live on disk for the Tailwind JIT and the prop-manifest
builder, and here's how to load the manifest." The full contract is
**`FrameworkAdapter`** (`src/adapter.ts`), which owns a framework end-to-end
through optional capabilities: the style channel(s), the SSR render pass,
codegen module + native theme projection (`themeToNative` + `themeModule`),
the component catalog + per-component install, the installed-components canvas
bundle (`canvasBundleSpec`), and the MCP instruction framing (`mcpIntro`).
Every consumer — renderer, JIT, MCP, codegen, canvas — resolves the adapter
per screen and asks it; nothing outside a provider package special-cases a
framework.

Concrete providers (each a separate package):

- `@velloo/provider-shadcn-upstream` — the default. Canvas renders from the
  internal `@velloo/shadcn-snapshot` runtime; real components install into the
  user's app via the shadcn CLI.
- `@velloo/provider-none` — bare HTML primitives + the `@velloo/helpers` set.
  The only provider with a CSS-framework choice (Tailwind classes or inline
  `style` objects). The proof the abstraction works at the trivial end.
- `@velloo/provider-mui` — Material UI v6, the fullest adapter: emotion SSR
  pass, `sx` channel, `createTheme` projection, canvas bundle. The template to
  copy when adding a framework.

**Adding a framework: read `docs/providers.md`** — the complete list of
registration points and the canvas-safe contract.

## What this package does NOT own

- Component implementations live in concrete provider packages, not here.
- The active providers are wired up by `@velloo/server` at boot time using
  `createProviderLoader({ id → factory })`. This package only owns the
  interface and the loader plumbing.
- Tailwind is a canvas-wide concern (one v4 install, embedded forever). It's
  not the provider's job to bring a Tailwind copy.
