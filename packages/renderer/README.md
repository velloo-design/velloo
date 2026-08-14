# @velloo/renderer

Design JSON → React tree → rendered HTML (and PNG via Playwright).

- `renderScreen(...)` — turn a `Screen` into an HTML string, applying snippet bodies, theme tokens, and design-mode wrappers. Used by the server's `/api/render/*` route to feed iframes.
- `screenshot(...)` — Playwright-based PNG renderer. Powers MCP `screenshot` and the dark-mode compare grid.
- `iframe-runtime.ts` — the inline script Velloo injects into rendered iframes. Owns:
  - selection / hover via DOM events
  - the parent-bound MessageChannel (pair with `packages/canvas/src/iframe-channel.ts`)
  - highlight + hover overlays

Pure with respect to user code — no I/O outside the screenshot path. Imports `@velloo/schema` + `@velloo/shadcn-snapshot`.

Designs are static here too: forms, links, click handlers — all stubs in design mode.
