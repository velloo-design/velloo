import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };

/** Date stamp recording which upstream shadcn pull this snapshot mirrors. */
export const snapshotVersion: string = (pkg as { snapshotVersion: string }).snapshotVersion;

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Package root holding `src/` (the component sources + Tailwind entry CSS) and
 * `dist/manifest.json`. Resolves from source (`here` = this `src/` dir) and
 * from the bundled CLI, where `build.ts` copies these assets to
 * `<dist>/pkgs/shadcn-snapshot` next to `cli.js`.
 */
function resolveRoot(): string {
  const dev = join(here, "..");
  const candidates = [
    process.env.VELLOO_SNAPSHOT_ROOT,
    join(here, "pkgs", "shadcn-snapshot"),
    dev,
  ].filter((p): p is string => Boolean(p));
  return candidates.find((r) => existsSync(join(r, "src", "tailwind-entry.css"))) ?? dev;
}

const root = resolveRoot();
const srcDir = join(root, "src");
const distDir = join(root, "dist");

/**
 * Absolute path to the Tailwind entry CSS shipped with the snapshot. The
 * server's JIT compiler reads this and runs Tailwind v4 against the live
 * page folder so any class — including ones we haven't thought of yet —
 * renders without a hand-rolled safelist.
 */
export const entryCssPath: string = join(srcDir, "tailwind-entry.css");

/**
 * Absolute path to the snapshot's component sources. The JIT scanner reads
 * these so the canvas picks up classes used by shipped components even if
 * no page references them directly.
 */
export const componentsDir: string = join(srcDir, "components");

/** Absolute path to the prebuilt manifest JSON (filled at `bun run build`). */
export const manifestPath: string = join(distDir, "manifest.json");
