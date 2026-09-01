---
name: verify
description: Verify a velloo change end-to-end by driving the real canvas + daemon. Use after changing server routes, canvas UI, renderer, or CLI behavior.
---

# Verifying velloo changes against the running app

## Build + launch an isolated daemon

The daemon serves the canvas from `packages/canvas/dist` — a stale dist
silently hides canvas changes. Server/CLI code runs from source, so a fresh
daemon spawn picks those up without a build.

```bash
cd packages/canvas && bun run build        # only needed for canvas changes

# Never restart the user's daemon (an MCP proxy session wedges on respawn).
# Copy the design folder and run a second daemon on a fixed port:
cp -R velloo /tmp/velloo-verify
bun packages/cli/src/cli.ts run /tmp/velloo-verify --port 7399 --background
# → canvas at http://127.0.0.1:7399, HTTP API under /api/*
```

Gotchas:
- The daemon idle-sleeps after ~5 min with nothing attached — re-run the
  same `run` command to wake it before a second drive.
- Stop + clean up when done:
  `bun packages/cli/src/cli.ts stop /tmp/velloo-verify && rm -rf /tmp/velloo-verify`

## Drive the canvas with Playwright

Playwright is a dependency of `@velloo/renderer` (Chromium already
installed — the screenshot pipeline uses it). Bun resolves it only from
inside that package, so put the drive script in `packages/renderer/` (delete
after):

```js
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (e) => console.error(`PAGE ERROR: ${e.message}`));
await page.goto("http://127.0.0.1:7399/?board=<id>");
await page.waitForSelector('[data-velloo-board="true"]');
```

Gotchas:
- **Scope selectors.** The sidebar always shows "Boards", the tree shows
  node labels, and design mockups can contain any text — `text=` waits
  against `page` match chrome, not your feature. Scope to a container
  (e.g. `page.locator('[data-slot="dialog-content"]')`).
- Frame iframes are same-origin: `page.frames()` reaches into rendered
  screens (e.g. count `.__velloo-selected` to assert selection highlight).
- URL state (`?board=…&screen=…&sel=…`) is a cheap assertion surface for
  navigation.
- Debounced UI (search input: 120ms) — wait for the result element, never
  fixed-sleep-then-act.
