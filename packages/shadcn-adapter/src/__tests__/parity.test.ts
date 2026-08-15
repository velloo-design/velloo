import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The adapter's components and the snapshot's `ui/` twins are the same
 * implementation maintained in two packages: the snapshot's copies must
 * stay self-contained because `installSnapshot()` copies the files
 * verbatim into user apps, while the adapter is the canonical layer the
 * upstream provider bundles. Until the snapshot is deleted
 * the copies must stay in lockstep — this suite
 * fails on any divergence beyond each package's import-path layout, so
 * an upstream bump applied to one side can't silently skip the other.
 */

const adapterRoot = join(import.meta.dir, "..");
const snapshotRoot = join(import.meta.dir, "../../../shadcn-snapshot/src");

/** Both layouts' specifiers for the shared helpers, canonicalized. */
const SPECIFIER_CANON: Record<string, string> = {
  "../lib/canvas-portal.tsx": "<canvas-portal>",
  "../canvas-portal.tsx": "<canvas-portal>",
  "../lib/utils.ts": "<utils>",
  "../../lib/utils.ts": "<utils>",
};

/**
 * Split a module into its import statements (specifiers canonicalized,
 * order-insensitive — the path difference changes Biome's sort order)
 * and the remaining source, which must match exactly.
 */
function normalized(content: string): { imports: string[]; body: string } {
  const imports: string[] = [];
  const body = content.replace(/^import[^;]*from "([^"]+)";/gm, (stmt, spec: string) => {
    imports.push(stmt.replace(`"${spec}"`, `"${SPECIFIER_CANON[spec] ?? spec}"`));
    return "";
  });
  imports.sort();
  return { imports, body };
}

async function readPair(adapterPath: string, snapshotPath: string) {
  const adapter = normalized(await readFile(join(adapterRoot, adapterPath), "utf8"));
  const snapshot = normalized(await readFile(join(snapshotRoot, snapshotPath), "utf8"));
  return { adapter, snapshot };
}

describe("adapter ↔ snapshot parity", () => {
  test("every adapter component matches its snapshot ui/ twin", async () => {
    const files = (await readdir(join(adapterRoot, "components")))
      .filter((f) => f.endsWith(".tsx"))
      .sort();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const { adapter, snapshot } = await readPair(
        join("components", file),
        join("components/ui", file),
      );
      expect({ file, ...snapshot }).toEqual({ file, ...adapter });
    }
  });

  test("canvas-portal and cn helpers match", async () => {
    const portal = await readPair("lib/canvas-portal.tsx", "components/canvas-portal.tsx");
    expect(portal.snapshot).toEqual(portal.adapter);

    const utils = await readPair("lib/utils.ts", "lib/utils.ts");
    expect(utils.snapshot).toEqual(utils.adapter);
  });
});
