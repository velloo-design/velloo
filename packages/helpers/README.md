# @velloo/helpers

The framework-neutral **velloo helper components** — `Box`, `Heading`, `Text`, `Icon`, `Image`, `SVG`, `Layer`, `Divider`, `Gradient`, `Placeholder`. No portals, no providers, no library idioms: plain HTML (styled with Tailwind utility classes wired to velloo's theme tokens) plus a thin lucide-react wrapper for `Icon`.

Every provider reuses them rather than forking:

- `@velloo/shadcn-snapshot` includes all ten in its registry (the canvas design-mode runtime that `provider-shadcn-upstream` reuses).
- `@velloo/provider-none` reuses nine on the Tailwind channel and the seven structural ones on the inline-`style` channel (its own inline-styled `Heading`/`Text` replace the Tailwind-classed ones there).
- `@velloo/provider-mui` reuses the six MUI has no equivalent for (`Icon`, imagery + composition helpers).

Exports:

- The components and their prop types.
- `HELPER_DESCRIPTORS` / `helperDescriptors(ids)` — the canonical `ComponentDescriptor` manifest entries (`source: "velloo"`). The snapshot's `build.ts` splices them into `dist/manifest.json` (augmenting `Icon` with the live lucide name list); `provider-none` composes its hand-authored manifest from them. `provider-mui` keeps its own deliberately MUI-flavored descriptors.
- `helpersRegistry(ids)` — a `ComponentRegistry` subset selector; each provider passes its own deliberate id list.
- `src/lowering.ts` — the codegen lowering tables (heading size ladder, text variants, placeholder aspect/size classes, and the provider-none Stack/Container class maps). Data-only mirrors of the class strings in the component files; `@velloo/codegen` consumes them. The literals stay duplicated in the `.tsx` components because the server's Tailwind JIT scans `**/*.tsx` for class candidates.
- `helpersComponentsDir` — absolute path to these sources, added to the Tailwind JIT scan so the helpers' structural default classes always compile.

Dependency position: `schema → … → provider → helpers → shadcn-snapshot → the concrete providers`. Keep it that way — helpers must stay importable by every provider without cycles.
