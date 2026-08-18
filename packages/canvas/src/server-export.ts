import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the built canvas SPA. The server reads files from here
 * to serve `/`, `/assets/*`, and SPA fallback routes.
 *
 * Resolution order, so the same module works whether it runs from source
 * or inlined into the bundled `velloo` binary:
 *   1. `VELLOO_CANVAS_DIST` — explicit override.
 *   2. `<here>/canvas` — packaged layout (canvas SPA sits next to `cli.js`).
 *   3. `<here>/../dist` — dev layout (`packages/canvas/src` → `packages/canvas/dist`).
 *
 * Dev: run `bun --cwd packages/canvas run build` first.
 */
function resolveCanvasDist(): string {
  const devLayout = join(here, "..", "dist");
  const candidates = [process.env.VELLOO_CANVAS_DIST, join(here, "canvas"), devLayout].filter(
    (p): p is string => Boolean(p),
  );
  return candidates.find((p) => existsSync(join(p, "index.html"))) ?? devLayout;
}

export const canvasDistPath: string = resolveCanvasDist();
