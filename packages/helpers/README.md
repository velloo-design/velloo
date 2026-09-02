# @velloo/helpers

The framework-neutral **velloo helper components** — `Box`, `Heading`, `Text`, `Prose`, `Icon`, `Image`, `SVG`, `Layer`, `Divider`, `Gradient`, `Placeholder`. No portals, no providers, no library idioms: plain HTML (styled with Tailwind utility classes wired to velloo's theme tokens) plus a thin lucide-react wrapper for `Icon`.

Every provider reuses them rather than forking:

- `@velloo/shadcn-snapshot` includes them all in its registry (the canvas design-mode runtime that `provider-shadcn-upstream` reuses).
- `@velloo/provider-none` reuses most on the Tailwind channel and the structural ones on the inline-`style` channel (its own inline-styled `Heading`/`Text` replace the Tailwind-classed ones there; `Prose` works on both, since `.typeset` is velloo CSS rather than a utility).
- `@velloo/provider-mui`, `-antd`, `-chakra` reuse the ones their library has no equivalent for (`Icon`, `Prose`, imagery + composition helpers).

Exports:

- The components and their prop types.
- `HELPER_DESCRIPTORS` / `helperDescriptors(ids)` — the canonical `ComponentDescriptor` manifest entries (`source: "velloo"`). The snapshot's `build.ts` splices them into `dist/manifest.json` (augmenting `Icon` with the live lucide name list); `provider-none` composes its hand-authored manifest from them. `provider-mui` keeps its own deliberately MUI-flavored descriptors.
- `helpersRegistry(ids)` — a `ComponentRegistry` subset selector; each provider passes its own deliberate id list.
- `cn` / `mergeTailwind` — velloo's configured `tailwind-merge`, taught the theme-generated typeset scale (`text-h1` is a font-size, not a color) so a `className` override still wins. The one merge for velloo-owned class strings: the components, `@velloo/codegen`'s emit, and the snapshot's `cn` all use it.
- `src/lowering.ts` — the codegen lowering tables (placeholder aspect/size classes, the provider-none Stack/Container class maps). Data-only mirrors of the class strings in the component files; `@velloo/codegen` consumes them. The literals stay duplicated in the `.tsx` components because the server's Tailwind JIT scans `**/*.tsx` for class candidates.
- `helpersComponentsDir` — absolute path to these sources, added to the Tailwind JIT scan so the helpers' structural default classes always compile.

The typography ladder is the exception, and the model for retiring the rest of `lowering.ts`: `Heading` / `Text` call `headingClasses` / `textClasses` from [`@velloo/schema/typeset`](../schema/src/typeset.ts), and so does codegen — one definition, no mirror. That works because the generated `@source inline(...)` safelist makes the JIT see those utilities without scanning a literal.

Dependency position: `schema → … → provider → helpers → shadcn-snapshot → the concrete providers`. Keep it that way — helpers must stay importable by every provider without cycles.
