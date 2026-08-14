# @velloo/schema

Zod schemas + TS types for everything that hits disk in a Velloo design folder:

- `ConfigSchema` — `.design/config.json`
- `ThemeSchema` — `theme/<name>.json`
- `ScreenSchema` — `screens/<id>.json`
- `BoardSchema` + `FrameSchema` — `boards/<id>.json`
- `SnippetSchema` — `snippets/<id>.json`
- `AnnotationSchema` + `CanvasNoteSchema` — sidecar JSON
- `NodeSchema` — the recursive tree primitive used inside screens and snippets

Plus pure utilities — `collectIds`, `findDuplicateIds`, `nodeId`, type guards (`isComponentNode`, `isSnippetInstance`, `isParamRef`).

**No I/O. No framework imports.** This is the contract every other Velloo package agrees on; keep it minimal.

Consumed by: `@velloo/renderer`, `@velloo/codegen`, `@velloo/server`, `@velloo/canvas`, `@velloo/cli`.
