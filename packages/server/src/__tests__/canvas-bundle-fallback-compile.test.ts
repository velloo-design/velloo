import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildCanvasBundle, type CanvasBundleSpec } from "../live/canvas-bundle.ts";

/**
 * A library's own fallback source is not preflighted, and still fails to
 * compile when the app lacks a package it reaches for: an app without the
 * `radix-ui` umbrella gets a synthesized shim of only the primitives it does
 * install, so the bundled `Field` importing `Label` finds no such export. That
 * one component must cost its own client mount, never its neighbours'.
 */

let app: string;

beforeAll(async () => {
  app = await mkdtemp(join(tmpdir(), "velloo-fallback-compile-"));
  const slot = join(app, "node_modules/@radix-ui/react-slot");
  await mkdir(slot, { recursive: true });
  await writeFile(
    join(slot, "package.json"),
    JSON.stringify({ name: "@radix-ui/react-slot", main: "index.js" }),
  );
  await writeFile(join(slot, "index.js"), "export const Root = () => null;\n");
  const reactHost = resolve(import.meta.dir, "../../../provider-mui");
  for (const name of ["react", "react-dom"]) {
    const dir = dirname(Bun.resolveSync(`${name}/package.json`, reactHost));
    await symlink(dir, join(app, "node_modules", name), "dir");
  }
  await writeFile(join(app, "package.json"), JSON.stringify({ name: "fallback-app" }));
  await mkdir(join(app, "src"), { recursive: true });
  await writeFile(
    join(app, "src/button.tsx"),
    'import { Slot } from "radix-ui";\nexport function Button() { return <Slot.Root />; }\n',
  );
  // A stylesheet Bun warns about (`@tailwind` is not CSS) beside the real error.
  await writeFile(join(app, "src/field.css"), "@tailwind base;\n");
  await writeFile(
    join(app, "src/field.tsx"),
    'import "./field.css";\nimport { Label } from "radix-ui";\nexport function Field() { return <Label.Root />; }\n',
  );
});

afterAll(async () => {
  await rm(app, { recursive: true, force: true });
});

const spec = (): CanvasBundleSpec => ({
  components: (ids) =>
    ids.map((id) =>
      id === "Button"
        ? {
            id,
            sources: [
              {
                importPath: join(app, "src/button.tsx"),
                exportName: id,
                fidelity: "exact",
                preflight: true,
              },
            ],
          }
        : {
            id,
            sources: [
              { importPath: join(app, "src/field.tsx"), exportName: id, fidelity: "fallback" },
            ],
          },
    ),
  styleRuntime: { kind: "none" },
});

describe("a library fallback that does not compile", () => {
  test("is drawn from its server render inside the mount, beside components that do compile", async () => {
    const result = await buildCanvasBundle(app, spec(), ["Button", "Field"]);
    expect(result.errors).toEqual([]);
    expect(result.usable).toBe(true);
    expect(result.staticRefs).toEqual(["Field"]);
    const field = result.diagnostics.find((entry) => entry.id === "Field");
    expect(field).toMatchObject({ status: "fallback", code: "static-fallback" });
    expect(field?.importPath).toBeUndefined();
    expect(field?.errors?.join(" ")).toContain('"Label"');
    expect(field?.errors?.join(" ")).not.toContain("@tailwind");
    expect(result.diagnostics.find((entry) => entry.id === "Button")?.status).toBe("exact");
  }, 30_000);

  test("names the error, not a warning, when nothing else would mount", async () => {
    const result = await buildCanvasBundle(app, spec(), ["Field"]);
    expect(result.usable).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.message).toContain('"Label"');
    expect(result.errors.some((error) => error.message.includes("@tailwind"))).toBe(false);
  }, 30_000);
});
