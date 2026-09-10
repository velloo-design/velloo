import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildCanvasBundle, type CanvasBundleSpec } from "../live/canvas-bundle.ts";

/**
 * A host installed with an isolated linker (`bun install --linker isolated`,
 * pnpm) links only its direct dependencies under `node_modules`; a package's
 * own dependencies sit beside it in the store. Resolving those from the host
 * root instead of the importing package failed the preflight of every
 * component reaching radix, and with it the whole screen's mount.
 */

let app: string;

async function pkg(dir: string, name: string, main: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ name, main: "index.js" }));
  await writeFile(join(dir, "index.js"), main);
}

async function link(target: string, at: string): Promise<void> {
  await mkdir(dirname(at), { recursive: true });
  await symlink(target, at, "dir");
}

beforeAll(async () => {
  app = await mkdtemp(join(tmpdir(), "velloo-isolated-"));
  const store = join(app, "node_modules/.bun");
  const slot = join(store, "@radix-ui+react-slot@1.0.0/node_modules/@radix-ui/react-slot");
  const refs = join(
    store,
    "@radix-ui+react-compose-refs@1.0.0/node_modules/@radix-ui/react-compose-refs",
  );
  await pkg(refs, "@radix-ui/react-compose-refs", "export const composeRefs = () => null;\n");
  await pkg(
    slot,
    "@radix-ui/react-slot",
    'import { composeRefs } from "@radix-ui/react-compose-refs";\nexport const Slot = () => composeRefs();\n',
  );
  // The store links a package's dependencies beside it, and only the host's
  // direct dependency at the top level.
  await link(refs, join(slot, "../react-compose-refs"));
  await link(slot, join(app, "node_modules/@radix-ui/react-slot"));
  // React must resolve from the host; borrow the copy provider-mui depends on.
  const reactHost = resolve(import.meta.dir, "../../../provider-mui");
  for (const name of ["react", "react-dom"]) {
    const dir = dirname(Bun.resolveSync(`${name}/package.json`, reactHost));
    await link(dir, join(app, "node_modules", name));
  }
  await writeFile(join(app, "package.json"), JSON.stringify({ name: "isolated-app" }));
  await mkdir(join(app, "src"), { recursive: true });
  await writeFile(
    join(app, "src/button.tsx"),
    'import { Slot } from "@radix-ui/react-slot";\nexport function Button() { return <Slot />; }\n',
  );
});

afterAll(async () => {
  await rm(app, { recursive: true, force: true });
});

describe("buildCanvasBundle under an isolated linker", () => {
  test("resolves a package's own dependencies from the package, not the host root", async () => {
    const spec: CanvasBundleSpec = {
      components: (ids) =>
        ids.map((id) => ({
          id,
          sources: [
            {
              importPath: resolve(app, "src/button.tsx"),
              exportName: id,
              fidelity: "exact",
              preflight: true,
            },
          ],
        })),
      styleRuntime: { kind: "none" },
    };
    const result = await buildCanvasBundle(app, spec, ["Button"]);
    expect(result.errors).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ id: "Button", status: "exact" }),
    ]);
    expect(result.usable).toBe(true);
  }, 30_000);
});
