# @velloo/server

The HTTP + MCP backend behind `velloo run`.

## Wiring

`createServer({ folder, port, mcpPort })` returns a handle that:

1. Loads the design folder (`design-folder.ts`).
2. Starts the file watcher (`watcher.ts`) and broadcasts `WatchEvent`s over WebSocket to the canvas (`broadcaster.ts`).
3. Boots a Bun HTTP server with a Hono app for `/api/*` and SPA fallback for the canvas (`app.ts`).
4. Boots the MCP server on a separate port (`mcp/server.ts`).
5. Owns a Tailwind JIT for on-the-fly class generation (`styles/tailwind-jit.ts`).

## Folder layout

```
src/
  app.ts                — Hono /api/* router
  broadcaster.ts        — WS fan-out
  design-folder.ts      — load + reload helpers; owns DesignFolder type
  fs.ts                 — writeJsonAtomic, writeText
  history.ts            — undo/redo log
  index.ts              — createServer + Bun.serve + static fallback
  path.ts               — Locator helpers (path[] or "@id")
  watcher.ts            — chokidar-style file watcher
  mcp/
    server.ts           — Streamable HTTP MCP transport + INSTRUCTIONS prompt
    tools/<area>.ts     — one file per MCP tool category
  mutations/
    <verb>.ts           — one file per mutation implementation
    api/<area>.ts       — orchestration wrappers (lock + impl) grouped by area
    index.ts            — re-exports everything for callers
    errors.ts           — MutationError variants + builders
    context.ts          — MutationContext + screen/board/snippet locks
    validate-ids.ts     — `$id` uniqueness wrapper (pure walker lives in @velloo/schema)
  routes/api-*.ts       — Hono route handlers per area
  theme/                — applyPreset, setToken, derivePaletteFromColor, matchVibe, …
  styles/tailwind-jit.ts
```

## Mutations layer

Every mutation:

1. Lives in `mutations/<verb>.ts`.
2. Returns `Result<Args, MutationError>` — never throws.
3. Is wrapped by an orchestrator in `mutations/api/<area>.ts` that acquires the right lock (`withScreenLock`, `withBoardLock`, `withSnippetLock`) and pipes events to the watcher.
4. Is re-exported by `mutations/index.ts`.

Direct mutation of folder state bypasses locks + watcher and may corrupt history. Always go through the API.
