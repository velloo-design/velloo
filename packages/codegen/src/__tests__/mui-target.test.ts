import { describe, expect, test } from "bun:test";
import { unwrap } from "@velloo/result";
import type { Screen } from "@velloo/schema";
import { emitCode } from "../emit-code/index.ts";
import { moduleTarget } from "../emit-code/target.ts";

/**
 * A codegen target makes emit framework-native: a MUI screen lowers to real
 * MUI component JSX (imported from `@mui/material`) with `sx={{…}}` styling,
 * NOT shadcn primitives + Tailwind classes. See docs/framework-native.md.
 */

const muiTarget = moduleTarget(
  ["Card", "CardContent", "Box", "Stack", "Typography", "Button"],
  "@mui/material",
);

function screenOf(tree: Screen["tree"]): Screen {
  return { id: "panel", name: "Panel", tree };
}

describe("emitCode with a MUI target", () => {
  test("emits MUI component names with sx, not shadcn lowering", async () => {
    const screen = screenOf({
      $ref: "Card",
      props: { variant: "outlined", sx: { p: 3, borderRadius: 2 } },
      children: [
        {
          $ref: "CardContent",
          children: [
            { $ref: "Typography", props: { variant: "h5", children: "Hello MUI" } },
            { $ref: "Button", props: { variant: "contained", children: "Go" } },
          ],
        },
      ],
    });

    const result = unwrap(await emitCode(screen, { target: muiTarget }));
    expect(result.jsx).toBe(
      `<Card variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
  <CardContent>
    <Typography variant="h5">Hello MUI</Typography>
    <Button variant="contained">Go</Button>
  </CardContent>
</Card>`,
    );
    // No shadcn install plan + no velloo helpers on a native framework.
    expect(result.componentsToInstall).toEqual([]);
    expect(result.helpersToMaterialize).toEqual([]);
    // sx is an object prop, not a className — so classesUsed stays empty.
    expect(result.classesUsed).toEqual([]);
    expect(result.componentsUsed).toEqual(["Button", "Card", "CardContent", "Typography"]);
  });

  test("the target wins over shadcn ids of the same name (Box → MUI, not lowered div)", async () => {
    // Without a target, `Box` lowers to a plain <div> via the shadcn REGISTRY.
    const plain = unwrap(await emitCode(screenOf({ $ref: "Box", props: { className: "flex" } })));
    expect(plain.jsx).toContain("<div");

    // With the MUI target, `Box` resolves to the MUI <Box> component verbatim.
    const native = unwrap(
      await emitCode(screenOf({ $ref: "Box", props: { sx: { display: "flex" } } }), {
        target: muiTarget,
      }),
    );
    expect(native.jsx).toBe(`<Box sx={{ display: "flex" }} />`);
  });
});
