import { afterEach, describe, expect, test } from "bun:test";
import { isComponentNode, type Node, repoKey } from "@velloo/schema";
import { type TestContext, testContext } from "../../testing/design-folder.ts";
import { compileRestrictedJsx } from "../restricted-jsx.ts";

/**
 * A page read out of the app imports every component it renders, and a
 * component library names its parts the way Velloo names its own: `Stack`,
 * `Card`, `Text`. By name alone those are Velloo's — a port of Mantine's
 * sample page, composed from its own file, drew seven of Velloo's `Stack`s.
 */
let t: TestContext;
afterEach(async () => {
  await t.cleanup();
});

const mantine = (name: string, member?: string) => {
  const identity = {
    importPath: "@mantine/core",
    exportName: name,
    ...(member ? { member } : {}),
  };
  const jsx = member ? `${name}.${member}` : name;
  return { id: `Mantine.${jsx}`, name: jsx, identity, key: repoKey(identity), styleProps: [] };
};

async function compile(source: string, entries = [mantine("Card"), mantine("Tabs", "List")]) {
  t = await testContext({ label: "imported-tags", screens: { home: true } });
  const screen = t.ctx.folder.screens.get("home");
  if (!screen) throw new Error("missing screen");
  const ctx = {
    ...t.ctx,
    repo: {
      catalog: () =>
        Promise.resolve({
          entries,
          byId: new Map(entries.map((entry) => [entry.id, entry])),
          byKey: new Map(entries.map((entry) => [entry.key, entry])),
        }),
      resolveName: () => Promise.resolve(null),
      host: () => undefined,
      preview: () => undefined,
      recipes: () => [],
    },
  } as never;
  const result = await compileRestrictedJsx(ctx, screen, source);
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join("; "));
  return result.node;
}

const children = (node: Node) => (isComponentNode(node) ? (node.children ?? []) : []);

describe("a tag the source imports", () => {
  test("is the component its import names, not Velloo's of the same name", async () => {
    const node = await compile(
      `import { Card, Tabs } from "@mantine/core";\n<Card padding="md"><Tabs.List /></Card>`,
    );
    expect(node).toMatchObject({
      $ref: "Card",
      $repo: { importPath: "@mantine/core", exportName: "Card" },
      props: { padding: "md" },
    });
    expect(children(node)[0]).toMatchObject({
      $ref: "Tabs.List",
      $repo: { importPath: "@mantine/core", exportName: "Tabs", member: "List" },
    });
  });

  test("stays Velloo's when nothing was imported under that name", async () => {
    const node = await compile(`<Card />`);
    expect(node).toMatchObject({ $ref: "Card" });
    expect((node as { $repo?: unknown }).$repo).toBeUndefined();
  });

  test("stays Velloo's when the import is not a component the app gives a design", async () => {
    const node = await compile(`import { Card } from "some-other-kit";\n<Card />`);
    expect((node as { $repo?: unknown }).$repo).toBeUndefined();
  });

  test("is found whichever workspace's catalog entry holds it", async () => {
    const identity = { importPath: "@mantine/core", exportName: "Card", app: "web" };
    const node = await compile(`import { Card } from "@mantine/core";\n<Card />`, [
      { id: "Mantine.Card", name: "Card", identity, key: repoKey(identity), styleProps: [] },
    ]);
    expect(node).toMatchObject({ $repo: { importPath: "@mantine/core", app: "web" } });
  });
});
