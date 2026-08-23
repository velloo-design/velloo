# @velloo/canvas

The Vite + React + Tailwind SPA that runs at `http://localhost:7300` when you start `velloo run`. Talks to `@velloo/server` over HTTP + WebSocket.

## Layout

```
src/
  api.ts                — barrel re-exporting api/ modules
  api/
    http.ts             — postMutate, postTheme, postJson
    discovery.ts        — fetchDesign, fetchScreen, fetchBoard, …
    history.ts          — undo / redo
    mutate.ts           — write operations
    theme.ts            — theme namespace
    annotations.ts      — annotation CRUD
    notes.ts            — canvas note CRUD
  store.ts              — single Zustand slice
  store-hooks.ts        — namespaced convenience hooks (useSelection, useViewport, …)
  iframe-channel.ts     — parent side of the canvas ↔ iframe MessageChannel
  ws-client.ts          — WebSocket → store invalidation
  url-state.ts          — sync selection / mode to URL hash
  path.ts               — string ↔ number[] path helpers
  components/
    ui/                  — vendored shadcn (Button, Dialog, Popover, Sonner, …)
    Frame.tsx           — one iframe placement on a board
    Frame/               — interactions hook + header + viewport-preset row
    Board.tsx           — pan/zoom + frames + annotations + notes
    Inspector.tsx       — right panel
    ThemePanel.tsx      — theme editor
    Tree.tsx            — sidebar tree of the current screen
    Annotation*.tsx     — annotation overlays + editor
    Note*.tsx           — canvas note overlays + editor
    …
  lib/utils.ts          — `cn` helper for the vendored shadcn
  styles.css            — shadcn token theme + `.dark` mode + cursor-mode utilities
  App.tsx               — top-level shell
  main.tsx              — entry point
```

## Conventions

- All write traffic goes through `api/mutate.ts` (server-side mutation handlers serialize via locks; the canvas just fires).
- WebSocket invalidations are the source of truth for refresh — direct refetch is the fallback. Don't refetch after every mutation; let `ws-client.ts` notify the store.
- The store is a single slice. New related fields can group via `store-hooks.ts`'s namespaced hooks — don't fragment the slice itself.
- Frames render iframes that load `/api/render/<screen>?w=&h=...`. Selection/hover comes back via MessageChannel.
- IDE chrome uses real shadcn from `@/components/ui/*`. The `@velloo/shadcn-snapshot` import in this package is **types-only** (`Manifest`, `ComponentDescriptor`, `PropDescriptor`) — never import its components, they're design-mode stubs.
- App theme (light/dark/system) is tracked in the store and applied as `.dark` on `<html>` by `app-theme.ts`. It's independent of `designMode` (which is passed to the iframe URLs to control the *design*'s theme).

The canvas package also exports `canvasDistPath` for the server's static handler.
