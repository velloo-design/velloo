# @velloo/provider

The component-provider abstraction every Velloo library entry implements.

A `ComponentProvider` says: "here are my React components, here's where their
source files live on disk for the Tailwind JIT and the prop-manifest builder,
and here's how to load the manifest." That single contract is enough for the
renderer, JIT, codegen, and canvas to be provider-agnostic.

Concrete providers (each a separate package):

- `@velloo/shadcn-snapshot` — the default. Embedded fork of shadcn-react with
  canvas-safe portal shims.
- (later) `@velloo/provider-none` — bare HTML primitives. No portals, no
  providers, no state — the proof the abstraction works at the trivial end.
- (later) `@velloo/provider-mui` — Material UI v6 with portal + ThemeProvider
  shims. The proof the abstraction works at the hard end.
- (later) host-repo provider — scans the user's app components, builds a
  registry without copying them onto disk.

## What this package does NOT own

- Component implementations live in concrete provider packages, not here.
- The active provider is wired up by `@velloo/server` at boot time using
  `createProviderLoader({ id → factory })`. This package only owns the
  interface and the loader plumbing.
- Tailwind is a canvas-wide concern (one v4 install, embedded forever). It's
  not the provider's job to bring a Tailwind copy.
