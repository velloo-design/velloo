import { afterEach, describe, expect, test } from "bun:test";
import { type Node, type RepoComponentRef, repoKey } from "@velloo/schema";
import { resolveComponentRefs } from "../../mutations/component-refs.ts";
import type { MutationContext } from "../../mutations/context.ts";
import { type TestContext, testContext } from "../../testing/design-folder.ts";
import { printJsx } from "../jsx-print.ts";
import { compileRestrictedJsx } from "../restricted-jsx.ts";

/**
 * Mantine's own AppShell pattern is `<AppShell.Section grow component={ScrollArea}>`,
 * and a design used to refuse it — the first failed call of nearly every
 * Mantine run, and it forced the page off `compose { file }`.
 */
let t: TestContext;
afterEach(async () => {
  await t.cleanup();
});

const mantine = (name: string, member?: string) => {
  const identity: RepoComponentRef = {
    importPath: "@mantine/core",
    exportName: name,
    ...(member ? { member } : {}),
  };
  const jsx = member ? `${name}.${member}` : name;
  return { id: `Mantine.${jsx}`, name: jsx, identity, key: repoKey(identity), styleProps: [] };
};

type Entry = ReturnType<typeof mantine>;

async function setup(
  entries: Entry[] = [mantine("AppShell", "Section")],
  resolveName: (name: string) => Entry | null = () => null,
) {
  t = await testContext({ label: "component-type", screens: { home: true } });
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
      resolveName: (name: string) => Promise.resolve(resolveName(name)),
      host: () => undefined,
      preview: () => undefined,
      recipes: () => [],
    },
  } as never;
  return { ctx: ctx as MutationContext, screen };
}

async function compile(
  source: string,
  entries?: Entry[],
  resolveName?: (name: string) => Entry | null,
) {
  const { ctx, screen } = await setup(entries, resolveName);
  return compileRestrictedJsx(ctx, screen, source);
}

async function node(...args: Parameters<typeof compile>): Promise<Node> {
  const result = await compile(...args);
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join("; "));
  return result.node;
}

describe("a component type passed as a prop", () => {
  test("is the app's component its import names, though the app never renders it as a tag", async () => {
    const scrollArea = mantine("ScrollArea");
    const compiled = await node(
      `import { AppShell, ScrollArea } from "@mantine/core";\n<AppShell.Section grow component={ScrollArea}>Links</AppShell.Section>`,
      [mantine("AppShell", "Section")],
      (name) => (name === "ScrollArea" ? scrollArea : null),
    );
    expect(compiled).toEqual({
      $ref: "AppShell.Section",
      $repo: { importPath: "@mantine/core", exportName: "AppShell", member: "Section" },
      props: {
        grow: true,
        component: {
          $type: {
            $ref: "ScrollArea",
            $repo: { importPath: "@mantine/core", exportName: "ScrollArea" },
          },
        },
        children: "Links",
      },
    });
  });

  test("an imported name the catalog holds wins over Velloo's of the same name", async () => {
    // `Box` is Velloo's own too; imported from Mantine it is Mantine's.
    const compiled = await node(
      `import { AppShell, Box } from "@mantine/core";\n<AppShell.Section component={Box} />`,
      [mantine("AppShell", "Section"), mantine("Box")],
    );
    expect(compiled).toMatchObject({
      props: {
        component: { $type: { $ref: "Box", $repo: { importPath: "@mantine/core" } } },
      },
    });
  });

  test("with no import, the screen's own component of that name, nested in data too", async () => {
    const compiled = await node(`<Box as={Heading} items={[{ label: "Home", icon: Text }]} />`);
    expect(compiled).toEqual({
      $ref: "Box",
      props: {
        as: { $type: { $ref: "Heading" } },
        items: [{ label: "Home", icon: { $type: { $ref: "Text" } } }],
      },
    });
  });

  test("a name nothing supplies is refused, naming the prop it was passed to", async () => {
    const result = await compile("<Box component={ScrolArea}>Go</Box>");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const [issue] = result.issues;
      expect(issue?.message).toContain("`component={ScrolArea}`");
      expect(issue?.message).toContain("`component={<");
      expect(issue?.message).not.toContain("icon={");
    }
    const imported = await compile(
      `import { Link } from "react-router-dom";\n<Box as={Link}>Go</Box>`,
    );
    expect(imported.ok).toBe(false);
    if (!imported.ok) expect(imported.issues[0]?.message).toContain('Link from "react-router-dom"');
  });

  test("reads back as the same JSX, and composes to the same nodes", async () => {
    const entries = [mantine("AppShell", "Section"), mantine("ScrollArea")];
    const { ctx, screen } = await setup(entries);
    // By catalog id, as printed JSX names the app's components: bare, `ScrollArea` is Velloo's.
    const source = `<Mantine.AppShell.Section grow component={Mantine.ScrollArea} links={[{ label: "Home", icon: Text }]} />`;
    const first = await compileRestrictedJsx(ctx, screen, source);
    if (!first.ok) throw new Error(first.issues[0]?.message);
    expect(first.node).toMatchObject({
      props: { component: { $type: { $ref: "ScrollArea", $repo: { exportName: "ScrollArea" } } } },
    });
    const printed = await printJsx(ctx, screen, first.node);
    expect(printed.notInJsx).toEqual([]);
    expect(printed.jsx).toContain("component={Mantine.ScrollArea}");
    expect(printed.jsx).toContain('links={[{"label": "Home", "icon": Text}]}');
    const back = await compileRestrictedJsx(ctx, screen, printed.jsx);
    expect(back.ok && back.node).toEqual(first.node);
  });
});

describe("a component type written as JSON", () => {
  test("is checked like a $ref: the app's name gains its identity, and an unknown one is refused", async () => {
    const { ctx, screen } = await setup([mantine("ScrollArea")]);
    const props = (name: string) => ({ links: [{ icon: { $type: { $ref: name } } }] });
    const qualified = await resolveComponentRefs(ctx, props("Mantine.ScrollArea"), screen);
    expect(qualified.ok ? (qualified.value as unknown) : null).toEqual({
      links: [
        {
          icon: {
            $type: {
              $ref: "ScrollArea",
              $repo: { importPath: "@mantine/core", exportName: "ScrollArea" },
            },
          },
        },
      ],
    });
    expect((await resolveComponentRefs(ctx, props("Heading"), screen)).ok).toBe(true);
    expect((await resolveComponentRefs(ctx, props("Nowhere"), screen)).ok).toBe(false);
  });
});
