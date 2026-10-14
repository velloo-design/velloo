import { describe, expect, test } from "bun:test";
import { unwrap } from "@velloo/result";
import type { Screen } from "@velloo/schema";
import { emitCode } from "../emit-code/index.ts";
import { frameworkTarget } from "../emit-code/target.ts";

const mantine = (exportName: string, member?: string) => ({
  importPath: "@mantine/core",
  exportName,
  ...(member ? { member } : {}),
});

function screenOf(tree: Screen["tree"]): Screen {
  return { id: "home", name: "Home", tree };
}

describe("emitCode — a component type as a prop value", () => {
  test("prints the app's component bare and imports it, though no element of it is on the screen", async () => {
    const result = unwrap(
      await emitCode(
        screenOf({
          $ref: "AppShell.Section",
          $repo: mantine("AppShell", "Section"),
          props: {
            grow: true,
            component: { $type: { $ref: "ScrollArea", $repo: mantine("ScrollArea") } },
          },
          children: [{ $ref: "AppShell.Navbar", $repo: mantine("AppShell", "Navbar") }],
        }),
      ),
    );
    expect(result.jsx).toContain("<AppShell.Section grow component={ScrollArea}>");
    expect(result.repoImports).toEqual([
      { from: "@mantine/core", named: ["AppShell", "ScrollArea"] },
    ]);
    expect(result.componentNames).toContain("ScrollArea");
  });

  test("a library type prints under its framework name, nested values included, and counts as used", async () => {
    const target = frameworkTarget([
      { id: "Button", module: "@mui/material" },
      { id: "Link", module: "@mui/material" },
      { id: "Home", jsxName: "HomeIcon", module: "@mui/icons-material" },
    ]);
    const result = unwrap(
      await emitCode(
        screenOf({
          $ref: "Button",
          props: {
            component: { $type: { $ref: "Link" } },
            links: [{ label: "Home", icon: { $type: { $ref: "Home" } } }],
            children: "Go",
          },
        }),
        { target },
      ),
    );
    expect(result.jsx).toContain("component={Link}");
    expect(result.jsx).toContain('links={[{ label: "Home", icon: HomeIcon }]}');
    expect(result.componentsUsed).toEqual(["Button", "Home", "Link"]);
    expect(result.packagesToImport).toEqual(["@mui/icons-material", "@mui/material"]);
  });

  test("a velloo primitive that lowers to an element is that element's tag", async () => {
    const result = unwrap(
      await emitCode(
        screenOf({
          $ref: "Box",
          props: { className: "p-2" },
          children: [
            {
              $ref: "Thing",
              $repo: { importPath: "@/components/thing", exportName: "Thing" },
              props: { as: { $type: { $ref: "Box" } } },
            },
          ],
        }),
      ),
    );
    expect(result.jsx).toContain('<Thing as="div" />');
  });

  test("a name nothing supplies is refused, as an element of it would be", async () => {
    const result = await emitCode(
      screenOf({
        $ref: "Thing",
        $repo: { importPath: "@/components/thing", exportName: "Thing" },
        props: { as: { $type: { $ref: "Nowhere" } } },
      }),
    );
    expect(result.ok).toBe(false);
  });
});
