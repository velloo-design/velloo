import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "@velloo/schema";
import { RepoComponents } from "../catalog.ts";

/**
 * The Mantine model-eval fixture imports 35 Mantine component families in its
 * route; the catalog lists exactly those — none of Mantine's ~120 other exports.
 * Runs wherever the fixture's dependencies are installed.
 */
const FIXTURE =
  process.env.VELLOO_MANTINE_FIXTURE ??
  join(homedir(), "play/velloo-modeleval/fixtures/mantine-sample");
const HAS_FIXTURE = existsSync(join(FIXTURE, "node_modules/@mantine/core/package.json"));

const FAMILIES = [
  "ActionIcon",
  "Alert",
  "AppShell",
  "Avatar",
  "AvatarGroup",
  "Badge",
  "Box",
  "Breadcrumbs",
  "Burger",
  "Button",
  "Card",
  "Center",
  "Checkbox",
  "Divider",
  "Grid",
  "Group",
  "Indicator",
  "Menu",
  "NavLink",
  "Paper",
  "Progress",
  "RingProgress",
  "ScrollArea",
  "SegmentedControl",
  "Select",
  "SimpleGrid",
  "Stack",
  "Table",
  "Tabs",
  "Text",
  "TextInput",
  "ThemeIcon",
  "Timeline",
  "Title",
  "Tooltip",
];

describe.skipIf(!HAS_FIXTURE)("Mantine fixture catalog", () => {
  test("lists exactly the 35 families the route renders, with the recipe and props", async () => {
    const repo = new RepoComponents({
      folderRoot: join(FIXTURE, "velloo"),
      config: () => ({ hostApp: { root: FIXTURE } }) as unknown as Config,
      reservedIds: () => new Set(["Box", "Stack", "Button", "Card", "Text", "Divider"]),
    });
    const catalog = await repo.catalog();
    const mantine = catalog.entries.filter((e) => e.packageName === "@mantine/core");
    const roots = [
      ...new Set(mantine.filter((e) => !e.viaFamily).map((e) => e.identity.exportName)),
    ];
    expect(roots.sort()).toEqual(FAMILIES);
    // Parts of a used family are placeable; unrelated exports never appear.
    expect(mantine.every((e) => FAMILIES.includes(e.identity.exportName))).toBe(true);
    expect(catalog.byId.get("Mantine.Button")?.recipe).toBe("mantine");
    expect(catalog.byId.get("Tabs")?.parts).toEqual(
      expect.arrayContaining(["List", "Tab", "Panel"]),
    );
    expect(
      catalog.byId.get("Badge")?.props.find((p) => p.name === "variant")?.enumValues,
    ).toContain("light");
    expect(catalog.apps[0]).toMatchObject({ recipes: ["mantine"], preview: { kind: "recipe" } });
    expect(catalog.apps[0]?.wrappers.map((w) => w.name)).toEqual(["MantineProvider"]);
  });
});
