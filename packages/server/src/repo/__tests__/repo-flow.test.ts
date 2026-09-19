import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { emitCode, emitSnippet } from "@velloo/codegen";
import { createProvider as createNoneProvider } from "@velloo/provider-none";
import { isComponentNode, repoKey } from "@velloo/schema";
import { compileRestrictedJsx } from "../../mcp/restricted-jsx.ts";
import { addNode, addSnippet, moveNode, updateProps } from "../../mutations/index.ts";
import { propWarnings, propWarningsForTree } from "../../mutations/prop-warnings.ts";
import { createUndoRouter } from "../../routes/undo.ts";
import { designConfig, type TestContext, testContext } from "../../testing/design-folder.ts";
import { createRepoComponents } from "../store.ts";
import { fixtureApp } from "./fixture-app.ts";

/**
 * The agent's path through the app's own components, end to end short of a
 * browser: a compose tag resolves to a repository identity, the identity
 * survives the mutation layer, styling lands in the props the component
 * declares, and emitted code imports exactly what the app imports.
 */
let app: Awaited<ReturnType<typeof fixtureApp>>;
let t: TestContext;

beforeAll(async () => {
  app = await fixtureApp();
  t = await testContext({
    provider: createNoneProvider(),
    config: designConfig({
      library: { id: "none", version: "t", source: "binary", componentsPath: "binary" },
      styling: { framework: "none" },
      hostApp: { root: app.root },
    }),
    screens: { home: { id: "home", name: "Home", tree: { $ref: "Box", children: [] } } },
  });
  t.ctx.repo = createRepoComponents(t.folder, t.ctx.providers);
});
afterAll(async () => {
  await t.cleanup();
  await app.cleanup();
});

describe("repository components through compose, mutations and emit", () => {
  test("compose resolves the app's components, compound parts and qualified names", async () => {
    const screen = t.ctx.folder.screens.get("home");
    if (!screen) throw new Error("no screen");
    const compiled = await compileRestrictedJsx(
      t.ctx,
      screen,
      `<Box>
        <Panel style={{"padding": "24px"}}>
          <Panel.Header title="Services" />
          <StatCard label="Uptime" value="99.9%" tone="positive" />
        </Panel>
        <Hero title="Ops" />
      </Box>`,
    );
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues));
    const root = compiled.node;
    if (!isComponentNode(root)) throw new Error("root is not a component");
    // `Box` stays the provider's: a bare name only reaches the repo catalog
    // when nothing else claims it.
    expect(root.$repo).toBeUndefined();
    const [panel, hero] = root.children ?? [];
    expect(panel).toMatchObject({
      $ref: "Panel",
      $repo: { importPath: "./src/components", exportName: "Panel" },
      children: [
        { $ref: "Panel.Header", $repo: { exportName: "Panel", member: "Header" } },
        { $ref: "StatCard", props: { tone: "positive" } },
      ],
    });
    expect(hero).toMatchObject({
      $ref: "Hero",
      $repo: { importPath: "./src/components/hero", exportName: "default" },
    });
  });

  test("add_node accepts a catalog id or an explicit identity", async () => {
    const byId = await addNode(t.ctx, {
      screenId: "home",
      parentPath: [],
      componentRef: "StatCard",
      props: { label: "Errors", value: "3" },
    });
    expect(byId.ok).toBe(true);
    const byIdentity = await addNode(t.ctx, {
      screenId: "home",
      parentPath: [],
      componentRef: "Unused",
      repo: { importPath: "./src/components", exportName: "Unused" },
    });
    expect(byIdentity.ok).toBe(true);
    const unknown = await addNode(t.ctx, {
      screenId: "home",
      parentPath: [],
      componentRef: "NotAThing",
    });
    expect(unknown.ok).toBe(false);
    const tree = t.ctx.folder.screens.get("home")?.tree;
    expect(tree && isComponentNode(tree) ? tree.children : []).toMatchObject([
      { $ref: "StatCard", $repo: { importPath: "./src/components", exportName: "StatCard" } },
      { $ref: "Unused", $repo: { exportName: "Unused" } },
    ]);
  });

  test("a style payload lands only in a prop the component declares", async () => {
    // StatCard declares `className` only: a string is taken, an object refused.
    const asClass = await updateProps(t.ctx, {
      screenId: "home",
      patches: [{ path: [0], style: "shadow-lg" }],
    });
    expect(asClass.ok).toBe(true);
    const asObject = await updateProps(t.ctx, {
      screenId: "home",
      patches: [{ path: [0], style: { padding: "8px" } }],
    });
    expect(asObject.ok).toBe(false);
    const tree = t.ctx.folder.screens.get("home")?.tree;
    const card = tree && isComponentNode(tree) ? tree.children?.[0] : undefined;
    expect(card && isComponentNode(card) ? card.props : undefined).toEqual({
      label: "Errors",
      value: "3",
      className: "shadow-lg",
    });
  });

  test("prop warnings check extracted enums and code-only props, never inherited unknowns", async () => {
    const screen = t.ctx.folder.screens.get("home");
    if (!screen) throw new Error("no screen");
    const repo = { importPath: "./src/components", exportName: "StatCard" };
    const warnings = await propWarnings(
      t.ctx,
      screen,
      "StatCard",
      { tone: "loud", onSelect: "x", somethingInherited: 1 },
      repo,
    );
    expect(warnings).toEqual([
      'StatCard: "tone" = "loud" is not one of [positive, negative, neutral]',
      expect.stringContaining('StatCard: "onSelect"'),
    ]);
    expect(repoKey(repo)).toBe("repo::./src/components#StatCard");
  });

  test("a node written into a snippet or a prop resolves or is refused, never deferred", async () => {
    const added = await addSnippet(t.ctx, {
      name: "Status row",
      params: [{ name: "icon", type: "node" }],
      tree: { $ref: "Box", children: [{ $ref: "Badge", props: { children: "Up" } }] },
    });
    if (!added.ok) throw new Error(JSON.stringify(added.error));
    // `Badge` is the app's own: it gains the identity compose would give it.
    expect(added.value.snippet.tree).toMatchObject({
      children: [{ $ref: "Badge", $repo: { importPath: "./src/components", exportName: "Badge" } }],
    });
    // A `node` param's default holds a subtree too.
    const defaulted = await addSnippet(t.ctx, {
      name: "Defaulted row",
      params: [{ name: "icon", type: "node", default: { $ref: "Badge" } }],
      tree: { $ref: "Box", children: [{ $param: "icon" }] },
    });
    if (!defaulted.ok) throw new Error(JSON.stringify(defaulted.error));
    expect(defaulted.value.snippet.params[0]?.default).toMatchObject({
      $repo: { exportName: "Badge" },
    });
    const unknown = await addSnippet(t.ctx, {
      name: "Broken row",
      tree: { $ref: "Box", children: [{ $ref: "ArrowUpward" }] },
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.kind).toBe("UnknownComponent");
    const prop = await updateProps(t.ctx, {
      screenId: "home",
      patches: [{ path: [], propPatch: { icon: { $ref: "ArrowUpward" } } }],
    });
    expect(prop.ok).toBe(false);
  });

  test("children given to a component that declares none are flagged", async () => {
    const screen = t.ctx.folder.screens.get("home");
    if (!screen) throw new Error("no screen");
    const card = { importPath: "./src/components", exportName: "StatCard" };
    const panel = { importPath: "./src/components", exportName: "Panel" };
    const warnings = await propWarningsForTree(t.ctx, screen, {
      $ref: "Panel",
      $repo: panel,
      children: [{ $ref: "StatCard", $repo: card, children: [{ $ref: "Box" }] }],
    });
    expect(warnings).toEqual([expect.stringContaining("[0] StatCard doesn't take children")]);
  });

  test("emit_code prints the app's components as themselves, with exact imports", async () => {
    const result = await emitCode(
      {
        id: "s",
        name: "S",
        tree: {
          $ref: "Panel",
          $repo: { importPath: "./src/components", exportName: "Panel" },
          props: { style: { padding: 24 } },
          children: [
            {
              $ref: "Panel.Header",
              $repo: { importPath: "./src/components", exportName: "Panel", member: "Header" },
              props: { title: "Services" },
            },
            {
              $ref: "Hero",
              $repo: {
                importPath: "./src/components/hero",
                exportName: "default",
                proxy: "hero-proxy",
              },
              props: { title: "Ops" },
            },
            {
              $ref: "Button",
              $repo: { importPath: "@acme/ui", exportName: "Button" },
              props: {
                variant: "light",
                leftSection: { $ref: "Icon", props: { name: "Plus" } },
                children: "Add",
              },
            },
            {
              $ref: "Button",
              $repo: { importPath: "@acme/ui", exportName: "Button" },
              props: { children: [{ $ref: "Icon", props: { name: "Plus" } }, "More"] },
            },
          ],
        },
      },
      { inlineStyle: true },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.jsx).toBe(
      [
        "<Panel style={{ padding: 24 }}>",
        '  <Panel.Header title="Services" />',
        '  <Hero title="Ops" />',
        '  <Button variant="light" leftSection={<Plus />}>Add</Button>',
        "  <Button>",
        "    <Plus />",
        '    {"More"}',
        "  </Button>",
        "</Panel>",
      ].join("\n"),
    );
    expect(result.value.repoImports).toEqual([
      { from: "./src/components", named: ["Panel"] },
      { from: "./src/components/hero", default: "Hero" },
      { from: "@acme/ui", named: ["Button"] },
    ]);
    // An app component named like a library one is never a shadcn install target.
    expect(result.value.componentsToInstall).toEqual([]);
    expect(result.value.componentsUsed).toEqual(["Icon"]);
  });

  test("legacy $emitAs nodes still emit the bare facade", async () => {
    const result = await emitCode({
      id: "s",
      name: "S",
      tree: {
        $ref: "Box",
        $emitAs: { name: "BillingTable", importPath: "@/components/billing-table" },
        children: [{ $ref: "Text", props: { children: "approximation" } }],
      },
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.jsx).toBe("<BillingTable />");
    expect(result.value.repoImports).toEqual([]);
  });
});

describe("repository identity survives the editing workflow", () => {
  const card = {
    $ref: "StatCard",
    $id: "kpi",
    $repo: { importPath: "./src/components", exportName: "StatCard", proxy: "kpi-proxy" },
    props: { label: "Uptime", value: "99.9%" },
  };

  test("moves, undo and redo keep $repo and its proxy on the node", async () => {
    const screen = {
      id: "edit",
      name: "Edit",
      tree: { $ref: "Box", children: [{ $ref: "Box", children: [] }, card] },
    };
    t.ctx.folder.screens.set("edit", screen);
    await t.write("screens/edit.json", screen);
    const moved = await moveNode(t.ctx, { screenId: "edit", fromPath: "@kpi", toParent: [0] });
    expect(moved.ok).toBe(true);
    const at = (): unknown => {
      const tree = t.ctx.folder.screens.get("edit")?.tree;
      return tree && isComponentNode(tree) ? tree : null;
    };
    expect(at()).toMatchObject({ children: [{ children: [card] }] });
    const undo = createUndoRouter(
      () => t.ctx.folder,
      () => undefined,
    );
    expect((await undo.request("/", { method: "POST" })).status).toBe(200);
    expect(at()).toMatchObject({ children: [{ $ref: "Box" }, card] });
    await undo.request("/redo", { method: "POST" });
    expect(at()).toMatchObject({ children: [{ children: [card] }] });
  });

  test("a snippet built around an app component keeps it, and emits its import", async () => {
    const added = await addSnippet(t.ctx, {
      name: "KPI row",
      params: [],
      tree: { $ref: "Box", children: [card] },
    });
    expect(added.ok).toBe(true);
    const snippet = t.ctx.folder.snippets.get("kpi-row");
    expect(snippet?.tree).toMatchObject({ children: [card] });
    const ir = await emitSnippet(snippet as NonNullable<typeof snippet>, { inlineStyle: true });
    if (!ir.ok) throw new Error(JSON.stringify(ir.error));
    expect(ir.value.repoImports).toEqual([{ from: "./src/components", named: ["StatCard"] }]);
    expect(ir.value.jsx).toContain('<StatCard label="Uptime" value="99.9%" />');
  });
});
