import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };

/** Date stamp recording which upstream shadcn pull this snapshot mirrors. */
export const snapshotVersion: string = (pkg as { snapshotVersion: string }).snapshotVersion;

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");
const distDir = join(here, "..", "dist");

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
