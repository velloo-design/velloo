# @velloo/provider-shadcn-upstream

Velloo provider that fetches shadcn components from the official
upstream registry at a pinned version and exposes them as a
`ComponentProvider`.

The user-visible win: components installed into the user's app are
**byte-identical to vanilla shadcn** (no Velloo modifications) so
`npx shadcn add <component>` works seamlessly alongside Velloo, and
the user's repo doesn't carry a Velloo-flavored fork of shadcn.

## What this provider gives you

- A fetcher (`fetchShadcn`) that downloads the configured shadcn
  component subset from `ui.shadcn.com/r/styles/<style>/<id>.json`
  and writes them to a destination directory.
- A lockfile with per-file SHA256 checksums so re-fetches detect
  upstream drift instead of silently picking up changes.
- An installer (`installShadcnUpstream`) that combines the fetch
  with a manifest generator producing the same prop-descriptor
  shape as the legacy `@velloo/shadcn-snapshot`.
- A `createProvider()` factory that returns a `ComponentProvider`
  with `id: "shadcn-upstream"`.

## Scope notes

The canvas's runtime registry currently reuses
`@velloo/shadcn-snapshot`'s components. The snapshot's overlays
already implement the canvas-safe adapter contract; the rest are
near-byte-identical to upstream. Reusing the snapshot's registry
avoids bundling 25+ `@radix-ui/*` sub-packages into the velloo
binary.

The runtime registry can later swap to dynamically-imported
upstream code if a real cost surfaces from the snapshot/upstream drift.
The infrastructure for that swap (adaptation map in
`@velloo/shadcn-adapter`, fetcher/cache here) is already in place.

The user-facing wins:

- The user's app gets vanilla shadcn (no Velloo modifications visible
  in their `components/ui/<name>.tsx` files).
- `npx shadcn add <component>` works in their app alongside Velloo's
  pre-installed components.
- The lockfile pins which shadcn version they're on; `velloo upgrade`
  (future) can refresh.
