import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const uiDir = join(src, "components", "ui");
const packages = join(src, "..", "..");

async function uiSources(): Promise<{ file: string; source: string }[]> {
  const files = (await readdir(uiDir)).filter((f) => f.endsWith(".tsx"));
  return Promise.all(
    files.map(async (file) => ({ file, source: await readFile(join(uiDir, file), "utf8") })),
  );
}

describe("the chrome's vendored shadcn", () => {
  /**
   * The invariant in CLAUDE.md ("two copies of shadcn, one upstream pull") had
   * nothing enforcing it, and the copies silently drifted a full style apart —
   * the snapshot moved to radix-nova at 55 components while this directory sat
   * on new-york at 21. Read by path on purpose: the canvas must not take a
   * dependency on @velloo/shadcn-snapshot, and a test reading a sibling's
   * package.json is not one.
   */
  test("tracks the same upstream pull as the design-mode snapshot", async () => {
    const read = async (pkg: string) =>
      JSON.parse(await readFile(join(packages, pkg, "package.json"), "utf8")) as {
        shadcnStyle?: string;
        shadcnCliVersion?: string;
      };
    const chrome = await read("canvas");
    const snapshot = await read("shadcn-snapshot");

    expect(chrome.shadcnStyle).toBe(snapshot.shadcnStyle);
    expect(chrome.shadcnCliVersion).toBe(snapshot.shadcnCliVersion);
  });

  /**
   * Upstream's sources reference `cn-*` semantic classes that live in the
   * shadcn.com app's own globals.css and are not distributed with the registry
   * item — so a pull can quietly add a class nothing defines, and the component
   * renders without the frosted menu surface or the heading face rather than
   * failing. Every one a component uses has to be defined in styles.css.
   */
  test("defines every cn-* class its components reference", async () => {
    const styles = await readFile(join(src, "styles.css"), "utf8");
    const defined = new Set(
      [...styles.matchAll(/@utility (cn-[a-z-]+)/g)].map((m) => m[1] as string),
    );

    const referenced = new Map<string, string>();
    for (const { file, source } of await uiSources()) {
      // Skip the provenance header, whose URL contains "shadcn-ui".
      const body = source.replace(/^\/\/.*$/gm, "");
      for (const match of body.matchAll(/\bcn-[a-z-]+/g)) {
        referenced.set(match[0], file);
      }
    }

    const undefinedClasses = [...referenced].filter(([name]) => !defined.has(name));
    expect(undefinedClasses).toEqual([]);
  });

  /**
   * The chrome's copy is the *real* shadcn — real Radix portals, working
   * dialogs, a live toaster. The snapshot's overlays are pinned open and
   * rendered inline so they can be selected inside a static design iframe.
   * Importing that fork here would put an inline, always-open dialog in the
   * IDE, which is why CLAUDE.md forbids the dependency outright.
   */
  test("never reaches into the canvas-safe snapshot fork", async () => {
    const offenders = (await uiSources())
      .filter(({ source }) => /@velloo\/shadcn-snapshot|canvas-portal/.test(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  /**
   * Every divergence from upstream is meant to be declared in vendor.ts's
   * ADAPTED set, so the next pull skips the file instead of reverting the
   * adaptation. A file that says it was hand-edited without being listed there
   * loses its edit on the next `bun run vendor`.
   */
  test("declares its hand-edited files so a re-pull cannot revert them", async () => {
    const vendorScript = await readFile(join(src, "..", "vendor.ts"), "utf8");
    const adapted = new Set(
      [...vendorScript.matchAll(/^\s{2}"([a-z-]+)",$/gm)].map((m) => m[1] as string),
    );

    const handEdited = (await uiSources())
      .filter(({ source }) => source.includes("ADAPTED"))
      .map(({ file }) => file.replace(/\.tsx$/, ""));

    expect(handEdited.length).toBeGreaterThan(0);
    for (const id of handEdited) {
      expect(adapted).toContain(id);
    }
  });
});
