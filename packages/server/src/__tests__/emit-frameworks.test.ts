import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitCode, emitHtml } from "@velloo/codegen";
import type { ComponentProvider, CssFramework } from "@velloo/provider";
import { unwrap } from "@velloo/result";
import type { Library, Screen } from "@velloo/schema";
import { loadDesignFolder } from "../design-folder.ts";
import { codegenTargetFor, emitFrameworkContextFor } from "../emit-context.ts";
import { registryForScreen } from "../extensions/registry.ts";
import { resolveProviders } from "../providers.ts";
import { designConfig, scaffoldDesignFolder } from "../testing/design-folder.ts";

/**
 * What every framework's `emit_code` produces, side by side.
 *
 * Each case resolves its framework through the production resolver on a real
 * folder, never a hand-built target: the resolver is where a framework's style
 * channel meets its codegen target (antd's channel sets `inlineStyle`, yet its
 * `Card`/`Button` must still emit as antd's own, not as inline-styled
 * `<div>`/`<button>`), and a hand-built target skips exactly that meeting.
 */

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
});

/** A real design folder on disk for one library + CSS-framework pairing. */
async function folderFor(
  id: Library["id"],
  framework?: CssFramework,
): Promise<{ providers: Record<string, ComponentProvider>; defaultProvider: ComponentProvider }> {
  const files = await scaffoldDesignFolder({
    label: `emit-${id}`,
    config: designConfig({
      library: { id },
      ...(framework ? { styling: { framework } } : {}),
    }),
  });
  cleanups.push(files.cleanup);
  const folder = await loadDesignFolder(files.root);
  return await resolveProviders(folder.config, folder.root);
}

interface Emitted {
  jsx: string;
  componentsToInstall: string[];
  helpersToMaterialize: string[];
  packagesToImport: string[];
}

async function emit(
  id: Library["id"],
  tree: Screen["tree"],
  framework?: CssFramework,
): Promise<Emitted> {
  const { providers, defaultProvider } = await folderFor(id, framework);
  const screen: Screen = { id: "home", name: "Home", tree };
  const context = await emitFrameworkContextFor(screen, providers, defaultProvider, framework);
  expect(context.html).toBe(false);
  return unwrap(await emitCode(screen, context.emit));
}

/** The velloo helpers every provider reuses, so one tree shape fits them all. */
const SHARED_HELPERS: Screen["tree"][] = [
  { $ref: "Icon", props: { name: "ArrowRight" } },
  { $ref: "Image", props: { src: "hero.png" } },
];

describe("emit_code — the framework's own components", () => {
  test("shadcn: the library's ids emit as themselves, with their registry items to install", async () => {
    const result = await emit("shadcn-upstream", {
      $ref: "Card",
      children: [
        { $ref: "CardContent", children: [{ $ref: "Button", props: { children: "Go" } }] },
        { $ref: "Badge", props: { children: "New" } },
        ...SHARED_HELPERS,
      ],
    });
    expect(result.jsx).toContain("<Card>");
    expect(result.jsx).toContain("<CardContent>");
    expect(result.jsx).toContain("<Button>Go</Button>");
    expect(result.jsx).toContain("<ArrowRight />");
    // shadcn ships components as files, so the plan is `npx shadcn add`, and it
    // names the registry item each id ships in rather than kebabing the id.
    expect(result.componentsToInstall).toEqual(["badge", "button", "card"]);
    expect(result.packagesToImport).toEqual([]);
    expect(result.helpersToMaterialize).toEqual(["Image"]);
  });

  test("shadcn: a registry item the host app already has is not reported for install", async () => {
    const app = await mkdtemp(join(tmpdir(), "velloo-emit-host-"));
    cleanups.push(() => rm(app, { recursive: true, force: true }));
    await mkdir(join(app, "components", "ui"), { recursive: true });
    await writeFile(join(app, "components", "ui", "button.tsx"), "export function Button() {}\n");
    const { createProvider } = await import("@velloo/provider-shadcn-upstream");
    const target = await codegenTargetFor(createProvider({ hostAppRoot: app }));
    const screen: Screen = {
      id: "home",
      name: "Home",
      tree: { $ref: "Card", children: [{ $ref: "Button", props: { children: "Go" } }] },
    };
    const result = unwrap(await emitCode(screen, { target }));
    expect(result.jsx).toContain("<Button>Go</Button>");
    expect(result.componentsToInstall).toEqual(["card"]);
    expect(result.helpersToMaterialize).toEqual([]);
  });

  test("MUI: ids import from the package, and MUI's own Divider is not a helper to author", async () => {
    const result = await emit("mui", {
      $ref: "Card",
      children: [
        { $ref: "Typography", props: { variant: "h4", children: "Hi" } },
        { $ref: "Divider" },
        { $ref: "Button", props: { variant: "contained", children: "Go" } },
        ...SHARED_HELPERS,
      ],
    });
    expect(result.jsx).toContain('<Typography variant="h4">Hi</Typography>');
    expect(result.jsx).toContain("<Divider />");
    expect(result.jsx).toContain('<Button variant="contained">Go</Button>');
    expect(result.packagesToImport).toEqual(["@mui/material"]);
    expect(result.componentsToInstall).toEqual([]);
    // `Divider` is a velloo composition helper in a folder whose framework has
    // none — MUI ships its own, so the emitted `<Divider />` is MUI's and
    // telling the agent to author one would be wrong.
    expect(result.helpersToMaterialize).toEqual(["Image"]);
  });

  test("antd: components stay antd's on the inline-style channel, dotted exports and all", async () => {
    const result = await emit("antd", {
      $ref: "Card",
      children: [
        { $ref: "TypographyTitle", props: { level: 2, children: "Hi" } },
        { $ref: "List", children: [{ $ref: "ListItem", props: { children: "One" } }] },
        { $ref: "ListItemMeta", props: { title: "Deployed" } },
        { $ref: "Button", props: { type: "primary", children: "Go" } },
        ...SHARED_HELPERS,
      ],
    });
    // antd's style channel is the inline `style` object, which must not put the
    // no-library inline lowering ahead of the framework: `Card` and `Button` are
    // antd components, not styled `<div>`/`<button>`.
    expect(result.jsx).toContain("<Card>");
    expect(result.jsx).toContain('<Button type="primary">Go</Button>');
    expect(result.jsx).not.toContain("<div");
    expect(result.jsx).not.toContain("<button");
    // The flat ids a `$ref` must use emit as the real dotted exports, so the
    // agent writes them straight out with no destructure step.
    expect(result.jsx).toContain("<Typography.Title level={2}>Hi</Typography.Title>");
    expect(result.jsx).toContain("<List.Item>One</List.Item>");
    expect(result.jsx).toContain('<List.Item.Meta title="Deployed" />');
    expect(result.packagesToImport).toEqual(["antd"]);
    expect(result.helpersToMaterialize).toEqual(["Image"]);
  });

  test("chakra: ids import from the package", async () => {
    const result = await emit("chakra", {
      $ref: "Card",
      children: [
        { $ref: "Heading", props: { size: "lg", children: "Hi" } },
        { $ref: "Divider" },
        ...SHARED_HELPERS,
      ],
    });
    expect(result.jsx).toContain('<Heading size="lg">Hi</Heading>');
    expect(result.jsx).toContain("<Divider />");
    expect(result.packagesToImport).toEqual(["@chakra-ui/react"]);
    expect(result.componentsToInstall).toEqual([]);
    expect(result.helpersToMaterialize).toEqual(["Image"]);
  });
});

/**
 * Compose lowers `<span>` to `as="span"` on every library's element component,
 * one design prop for all of them; the emitted code has to say it the way the
 * framework does.
 */
describe("emit_code — an element's tag override in the framework's own words", () => {
  const lowered: Screen["tree"] = {
    $ref: "Box",
    props: { as: "section" },
    children: [
      { $ref: "Box", props: { as: "span", children: "Total" } },
      { $ref: "Box", props: { as: "b", component: "strong", children: "3" } },
    ],
  };

  test("MUI: Box's `as` emits as `component`", async () => {
    const result = await emit("mui", lowered);
    expect(result.jsx).toContain('<Box component="section">');
    expect(result.jsx).toContain('<Box component="span">Total</Box>');
    // A `component` the design set itself is MUI's already, and wins.
    expect(result.jsx).toContain('<Box component="strong">3</Box>');
    expect(result.jsx).not.toContain(" as=");
  });

  test("chakra: Box takes `as` natively, so it stays", async () => {
    const result = await emit("chakra", lowered);
    expect(result.jsx).toContain('<Box as="section">');
    expect(result.jsx).toContain('<Box as="span">Total</Box>');
  });

  test("antd: the velloo Box lowers to the bare element", async () => {
    const result = await emit("antd", lowered);
    expect(result.jsx).toContain("<section>");
    expect(result.jsx).toContain("<span>Total</span>");
  });
});

describe("emit_code — a folder with no UI library", () => {
  const tree: Screen["tree"] = {
    $ref: "Stack",
    props: { direction: "col", gap: 6 },
    children: [
      {
        $ref: "Card",
        children: [
          { $ref: "Heading", props: { level: 2, children: "Hi" } },
          { $ref: "Button", props: { variant: "outline", children: "Go" } },
          { $ref: "Input" },
        ],
      },
      ...SHARED_HELPERS,
    ],
  };

  test("none/tailwind: the primitives lower to plain HTML with their own classes", async () => {
    const result = await emit("none", tree, "tailwind");
    // These are velloo's own primitives, not shadcn's: emitting `<Card>` /
    // `<Button>` / `<Input>` and advising `npx shadcn add button card input`
    // would install components with different variants from the ones the
    // canvas rendered.
    expect(result.jsx).toContain('<div className="flex flex-col gap-6">');
    expect(result.jsx).toContain("rounded-lg border border-border bg-card");
    expect(result.jsx).toContain('<button className="');
    expect(result.jsx).toContain("bg-transparent text-foreground border border-border");
    expect(result.jsx).toContain('<input className="');
    expect(result.jsx).not.toContain("<Card");
    expect(result.jsx).not.toContain("<Button");
    expect(result.componentsToInstall).toEqual([]);
    expect(result.packagesToImport).toEqual([]);
    expect(result.helpersToMaterialize).toEqual(["Image"]);
  });

  test("none/none: the same primitives lower to inline style, Tailwind-free", async () => {
    const result = await emit("none", tree, "none");
    expect(result.jsx).toContain('display: "flex"');
    expect(result.jsx).toContain('gap: "1.5rem"');
    expect(result.jsx).toContain("<button style={{");
    expect(result.jsx).toContain("<input style={{");
    expect(result.jsx).not.toContain("className");
    expect(result.componentsToInstall).toEqual([]);
    // A composition helper carries runtime logic whatever the CSS framework, so
    // it is still the agent's to author on the inline-style channel too.
    expect(result.helpersToMaterialize).toEqual(["Image"]);
  });
});

describe("emit_code — an HTML/htmx folder", () => {
  test("emits native markup through the adapter, not JSX", async () => {
    const { providers, defaultProvider } = await folderFor("html");
    const screen: Screen = {
      id: "home",
      name: "Home",
      tree: {
        $ref: "Html",
        props: { as: "section" },
        children: [{ $ref: "Html", props: { as: "p", children: "Hello" } }],
      },
    };
    const context = await emitFrameworkContextFor(screen, providers, defaultProvider);
    expect(context.html).toBe(true);
    expect(context.tailwind).toBe(false);
    const result = await emitHtml(screen, {
      registry: registryForScreen(screen, providers, defaultProvider, {}, undefined),
    });
    expect(result.format).toBe("html");
    expect(result.html).toContain("<section");
    expect(result.html).toContain("Hello");
  });
});

/**
 * Renders-green-but-can't-emit is the worst failure shape for the agent loop: a
 * screen passes `ensureKnownComponent`, renders, screenshots clean, and then
 * dies at `emit_code` with UnknownComponent. Every id a shipping provider can
 * render must therefore resolve down the emit chain — the framework's target
 * first, the velloo primitives after.
 */
describe("every component a provider renders can be emitted", () => {
  const libraries: { id: Library["id"]; framework?: CssFramework }[] = [
    { id: "shadcn-upstream" },
    { id: "mui" },
    { id: "antd" },
    { id: "chakra" },
    { id: "none", framework: "tailwind" },
    { id: "none", framework: "none" },
  ];

  for (const { id, framework } of libraries) {
    test(`${id}${framework ? `/${framework}` : ""}`, async () => {
      const { providers, defaultProvider } = await folderFor(id, framework);
      const screen: Screen = { id: "home", name: "Home", tree: { $ref: "Box" } };
      const context = await emitFrameworkContextFor(screen, providers, defaultProvider, framework);
      const ids = Object.keys(registryForScreen(screen, providers, defaultProvider, {}, framework));
      expect(ids.length).toBeGreaterThan(5);
      const unemittable: string[] = [];
      for (const ref of ids) {
        const result = await emitCode(
          { id: "home", name: "Home", tree: { $ref: ref } },
          context.emit,
        );
        if (!result.ok) unemittable.push(`${ref}: ${JSON.stringify(result.error)}`);
      }
      expect(unemittable).toEqual([]);
    });
  }
});
