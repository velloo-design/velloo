# @velloo/provider-shadcn-upstream

Velloo's shadcn framework adapter. It discovers vanilla shadcn files in the
host app, exposes their manifest to the inspector, and supplies an embedded
snapshot for offline SSR and bounded canvas fallbacks.

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
- A per-screen canvas bundle that imports client-safe component files directly
  from the app, keeps compound children intact, and mixes them with Velloo
  helpers and explicit canvas-safe overlay adaptations.
- Per-component `exact`, `adapted`, `fallback`, or `unavailable` diagnostics.
  One broken host file falls back without discarding exact neighboring files.
- Host-source manifest enrichment for common CVA variants and explicit props,
  plus source watching so ordinary component edits refresh the canvas.

## Scope notes

The embedded `@velloo/shadcn-snapshot` is still the fail-safe SSR registry and
the source of canvas-safe portal/state adaptations. It is not the first choice
for ordinary installed components: the browser bundle preflights and selects
the app file first. Arbitrary app code is intentionally not guaranteed. A file
that cannot compile for the browser canvas uses its named fallback and reports
why through `component_status` and `/api/canvas/status`.

The user-facing wins:

- The user's app gets vanilla shadcn (no Velloo modifications visible
  in their `components/ui/<name>.tsx` files).
- `npx shadcn add <component>` works in their app alongside Velloo's
  pre-installed components.
- The lockfile pins which shadcn version they're on; `velloo upgrade`
  (future) can refresh.
