import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * One name from the helpers index costs that name, not the package.
 *
 * Browser sources reach the helpers through their index — the snapshot's
 * `lib/utils` for `cn`, the no-library primitives for `ELEMENT_TAG` — and the
 * index also re-exports `Icon`, whose data is 0.6 MB. A bundler drops an
 * unused module only if importing it does nothing, and nothing else can be
 * relied on: in the installed binary these sources sit under velloo's own
 * package, where a `sideEffects` flag of the helpers' is not read. So the icon
 * module must stay free of top-level work; one call there put the whole icon
 * set in every screen that mounted a Velloo primitive.
 */

const INDEX = resolve(import.meta.dir, "../index.ts");
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "velloo-helpers-shake-"));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

async function bundleOf(names: string): Promise<string> {
  const entry = join(dir, `${names.replace(/\W+/g, "-")}.ts`);
  await writeFile(
    entry,
    `import { ${names} } from ${JSON.stringify(INDEX)};\nconsole.log(${names});\n`,
  );
  const built = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    external: ["react", "react/jsx-runtime", "clsx", "tailwind-merge"],
  });
  expect(built.success).toBe(true);
  return (await built.outputs[0]?.text()) ?? "";
}

test("a constant or `cn` from the index leaves the icon data out", async () => {
  for (const names of ["ELEMENT_TAG", "cn", "Box"]) {
    const code = await bundleOf(names);
    // Booleans, not the code: a failure here would print 0.6 MB of it.
    expect(code.includes("icon-data")).toBe(false);
    expect(code.length < 20_000).toBe(true);
  }
});

test("`Icon` still brings its data", async () => {
  expect((await bundleOf("Icon")).includes("icon-data")).toBe(true);
});
