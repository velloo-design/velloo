import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the built canvas SPA. The server reads files from here
 * to serve `/`, `/assets/*`, and SPA fallback routes.
 *
 * Run `bun --cwd packages/canvas run build` first.
 */
export const canvasDistPath: string = join(here, "..", "dist");
