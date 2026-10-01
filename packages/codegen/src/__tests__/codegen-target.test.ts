import { describe, expect, test } from "bun:test";
import { unwrap } from "@velloo/result";
import type { Screen } from "@velloo/schema";
import { emitCode } from "../emit-code/index.ts";
import { frameworkTarget } from "../emit-code/target.ts";

/**
 * The target mechanism itself, with no framework privileged.
 *
 * A target owns the ids its library declares and says how each is provisioned;
 * what it doesn't own falls through to the velloo primitives. Both halves used
 * to be lopsided: the shadcn registry was compiled into codegen as the default
 * lowering path, and every other framework was expressed as an opt-out of it.
 */

const native = frameworkTarget([
  { id: "Card", module: "@acme/ui" },
  { id: "Box", module: "@acme/ui" },
  { id: "Divider", module: "@acme/ui" },
  { id: "Stack", module: "@acme/ui" },
  // A library that ships a component as a file into the app rather than as part
  // of the package — shadcn's shape.
  { id: "DataGrid", install: "data-grid" },
  // A flat id whose real export is a dotted member path.
  { id: "TypographyTitle", jsxName: "Typography.Title", module: "@acme/ui" },
]);

function screenOf(tree: Screen["tree"]): Screen {
  return { id: "panel", name: "Panel", tree };
}

describe("a framework's codegen target", () => {
  test("its components emit verbatim, with the package to import them from", async () => {
    const result = unwrap(
      await emitCode(
        screenOf({
          $ref: "Card",
          props: { variant: "outlined", sx: { p: 3 } },
          children: [{ $ref: "DataGrid", props: { rows: 3 } }],
        }),
        { target: native },
      ),
    );
    expect(result.jsx).toBe(`<Card variant="outlined" sx={{ p: 3 }}>
  <DataGrid rows={3} />
</Card>`);
    // Each component is provisioned the way its own library ships it.
    expect(result.packagesToImport).toEqual(["@acme/ui"]);
    expect(result.componentsToInstall).toEqual(["data-grid"]);
    // An object style prop is not a className, so classesUsed stays empty.
    expect(result.classesUsed).toEqual([]);
    expect(result.componentsUsed).toEqual(["Card", "DataGrid"]);
  });

  test("a flat id emits as the dotted export its library really has", async () => {
    const result = unwrap(
      await emitCode(screenOf({ $ref: "TypographyTitle", props: { level: 2, children: "Hi" } }), {
        target: native,
      }),
    );
    // A `$ref` cannot carry a dot, so the id is flat and the emit is not — which
    // is what replaces telling the agent in prose to destructure it.
    expect(result.jsx).toBe(`<Typography.Title level={2}>Hi</Typography.Title>`);
    expect(result.componentsUsed).toEqual(["TypographyTitle"]);
  });

  test("it wins over a velloo primitive of the same name", async () => {
    // `Box` and `Stack` lower to plain HTML for a framework that has neither.
    const velloo = unwrap(await emitCode(screenOf({ $ref: "Box", props: { className: "flex" } })));
    expect(velloo.jsx).toBe(`<div className="flex" />`);
    // The framework's own `Box` is a component, not a lowered div.
    const owned = unwrap(
      await emitCode(screenOf({ $ref: "Box", props: { sx: { display: "flex" } } }), {
        target: native,
      }),
    );
    expect(owned.jsx).toBe(`<Box sx={{ display: "flex" }} />`);
  });

  test("a composition helper the framework ships is not also a helper to author", async () => {
    const owned = unwrap(await emitCode(screenOf({ $ref: "Divider" }), { target: native }));
    expect(owned.helpersToMaterialize).toEqual([]);
    // With no framework of its own, `Divider` is velloo's — real runtime logic
    // (label slots), so the agent authors it.
    const velloo = unwrap(await emitCode(screenOf({ $ref: "Divider" })));
    expect(velloo.helpersToMaterialize).toEqual(["Divider"]);
  });

  test("ids it does not own fall through — Icon stays lucide, not the library's", async () => {
    const result = unwrap(
      await emitCode(screenOf({ $ref: "Icon", props: { name: "arrow-right" } }), {
        target: native,
      }),
    );
    expect(result.jsx).toBe(`<ArrowRight />`);
    expect(result.iconsUsed).toEqual(["ArrowRight"]);
  });

  test("a name no target owns is an error, not an invented tag", async () => {
    const result = await emitCode(screenOf({ $ref: "Carousel3000" }), { target: native });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: "UnknownComponent", ref: "Carousel3000" });
  });

  test("a $ref naming an Object prototype member resolves off neither channel", async () => {
    for (const ref of ["constructor", "toString", "__proto__"]) {
      const result = await emitCode(screenOf({ $ref: ref }), { target: native });
      expect(result.ok).toBe(false);
    }
  });
});
