import { describe, expect, test } from "bun:test";
import { createProvider as createHtmlProvider } from "@velloo/provider-html";
import type { Node, Screen } from "@velloo/schema";
import type { MutationContext } from "../../mutations/index.ts";
import type { RepoCatalog, RepoCatalogEntry } from "../../repo/catalog.ts";
import { testContext } from "../../testing/design-folder.ts";
import {
  diagnosticsForScreen,
  opaqueScreenDiagnostics,
  rawColorDiagnostics,
  renderDiagnostics,
  shadowedByVelloo,
  shadowedDiagnostics,
  textToneDiagnostics,
} from "../diagnostics.ts";

function screenWith(tree: Screen["tree"]): Screen {
  return { id: "home", name: "Home", tree };
}

/**
 * The render guard keeps a broken component from taking the screen down, which
 * means a mutation that produced one succeeds. Without a diagnostic the agent
 * that composed it is told nothing is wrong — it would have to screenshot and
 * look at the picture to find out otherwise.
 */
describe("renderDiagnostics", () => {
  test("reports a component that threw, at the path that used it", async () => {
    const { ctx } = await testContext();
    const screen = screenWith({
      $ref: "Card",
      children: [
        { $ref: "Heading", props: { level: 2, children: "Settings" } },
        { $ref: "TabsTrigger", props: { value: "one", children: "One" } },
      ],
    });

    const diagnostics = renderDiagnostics(ctx, screen);
    expect(diagnostics).toHaveLength(1);
    const [diagnostic] = diagnostics;
    expect(diagnostic?.code).toBe("render/component-threw");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.path).toEqual([1]);
    expect(diagnostic?.message).toContain("TabsTrigger");
    // The component's own words, so the agent learns what it needs.
    expect(diagnostic?.message).toContain("Tabs");
  });

  test("a healthy screen produces nothing", async () => {
    const { ctx } = await testContext();
    const screen = screenWith({
      $ref: "Card",
      children: [
        { $ref: "Heading", props: { level: 2, children: "Settings" } },
        { $ref: "Button", props: { children: "Save" } },
      ],
    });
    expect(renderDiagnostics(ctx, screen)).toEqual([]);
  });

  test("a correctly-nested context consumer is not reported", async () => {
    const { ctx } = await testContext();
    const screen = screenWith({
      $ref: "Tabs",
      props: { defaultValue: "one" },
      children: [
        {
          $ref: "TabsList",
          children: [{ $ref: "TabsTrigger", props: { value: "one", children: "One" } }],
        },
      ],
    });
    expect(renderDiagnostics(ctx, screen)).toEqual([]);
  });

  test("every use of a broken component gets its own path", async () => {
    const { ctx } = await testContext();
    const screen = screenWith({
      $ref: "Card",
      children: [
        { $ref: "TabsTrigger", props: { value: "a", children: "A" } },
        {
          $ref: "Box",
          children: [{ $ref: "TabsTrigger", props: { value: "b", children: "B" } }],
        },
      ],
    });
    expect(renderDiagnostics(ctx, screen).map((d) => d.path)).toEqual([[0], [1, 0]]);
  });

  /**
   * React's refusal of `<input>` children names no component; reporting it at
   * every `Box` would bury the one that matters under every layout wrapper.
   */
  test("a throw that names no component is reported at its own node only", async () => {
    const { ctx } = await testContext();
    const screen = screenWith({
      $ref: "Box",
      children: [
        { $ref: "Box", props: { children: "Search" } },
        { $ref: "Box", props: { as: "input", children: "typed text" } },
      ],
    });
    expect(renderDiagnostics(ctx, screen)).toEqual([
      {
        severity: "error",
        code: "render/component-threw",
        path: [1],
        message: expect.stringContaining("input is a self-closing tag"),
      },
    ]);
  });

  /**
   * The screen draws now, so this is the only thing that tells the agent at
   * all: the whole-screen refusal that used to make a bad `$ref` obvious is
   * gone, and what is left on the canvas is one dashed box among many.
   */
  test("an unknown $ref is reported as missing, not as a component that threw", async () => {
    const { ctx } = await testContext();
    const screen = screenWith({
      $ref: "Card",
      children: [{ $ref: "NoSuchComponent", props: {} }],
    });
    expect(renderDiagnostics(ctx, screen)).toEqual([
      {
        severity: "error",
        code: "render/component-missing",
        path: [0],
        message: expect.stringContaining("`NoSuchComponent` is not in this screen's library"),
      },
    ]);
  });
});

/**
 * The audit itself is covered in `dark-mode-audit`; what matters here is what
 * an agent actually receives when a whole hero section is white-on-photo.
 */
describe("opaqueScreenDiagnostics", () => {
  const app = {
    $ref: "App",
    $repo: { importPath: "./src/App", exportName: "default" },
  } satisfies Node;

  test("flags the app's whole page placed as the screen's one node", async () => {
    const { ctx } = await testContext();
    for (const tree of [app, { $ref: "Box", children: [app] }]) {
      const [diagnostic, ...rest] = opaqueScreenDiagnostics(ctx, screenWith(tree));
      expect(rest).toEqual([]);
      expect(diagnostic?.code).toBe("screen/opaque");
      expect(diagnostic?.message).toContain("`App`");
    }
  });

  test("flags a page-sized extension the same way", async () => {
    const { ctx } = await testContext({
      config: { extensions: { FullHomePage: { importPath: "@/components/home", props: [] } } },
    });
    const diagnostics = opaqueScreenDiagnostics(ctx, screenWith({ $ref: "FullHomePage" }));
    expect(diagnostics.map((d) => d.code)).toEqual(["screen/opaque"]);
  });

  test("a page composed from the app's parts is left alone", async () => {
    const { ctx } = await testContext();
    const screen = screenWith({
      $ref: "Box",
      children: [app, { $ref: "Heading", props: { children: "Reviews" } }],
    });
    expect(opaqueScreenDiagnostics(ctx, screen)).toEqual([]);
    expect(opaqueScreenDiagnostics(ctx, screenWith({ $ref: "Box" }))).toEqual([]);
  });
});

describe("rawColorDiagnostics", () => {
  const hero = (count: number): Node => ({
    $ref: "Box",
    props: { className: "relative" },
    children: Array.from({ length: count }, (_, i) => ({
      $ref: "Text",
      $id: `line-${i}`,
      props: { className: "text-white" },
    })),
  });

  test("lists every offender while the list is still a list of things to fix", () => {
    const out = rawColorDiagnostics(hero(3));
    expect(out).toHaveLength(3);
    expect(out.every((d) => d.code === "theme/raw-color")).toBe(true);
    expect(out.some((d) => d.message.includes("more node(s)"))).toBe(false);
  });

  test("caps the repetition and names the opt-out once", () => {
    const out = rawColorDiagnostics(hero(30));
    // Eight worked examples, then one line that says what to do about the rest.
    expect(out).toHaveLength(9);
    const summary = out.at(-1);
    expect(summary?.message).toContain("22 more node(s)");
    expect(summary?.message).toContain("data-accent");
    // Named where it is read: the guide had it, the warning did not.
    expect(summary?.message).toContain("does not cascade");
    expect(summary?.suggestion).toBeUndefined();
  });

  test("an exempted node produces nothing, cap or no cap", () => {
    const tree: Node = {
      $ref: "Box",
      children: [
        { $ref: "Text", $id: "t", props: { className: "text-white", "data-accent": "ok" } },
      ],
    };
    expect(rawColorDiagnostics(tree)).toEqual([]);
  });
});

describe("textToneDiagnostics", () => {
  const button = (child: object, repo = false) => ({
    $ref: "Button",
    ...(repo ? { $repo: { importPath: "@/components/ui/button", exportName: "Button" } } : {}),
    props: {},
    children: [{ $ref: "Box", props: {}, children: [child] }],
  });

  test("flags a Text that would paint a button label in the body color", () => {
    const out = textToneDiagnostics(button({ $ref: "Text", props: { children: "Add" } }) as never);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ code: "theme/text-tone", path: [0, 0] });
  });

  test("stays quiet where the label is the body color anyway", () => {
    const small = { $ref: "Text", props: { variant: "small", children: "Add" } };
    expect(textToneDiagnostics(button(small) as never)).toEqual([]);
    const outline = {
      $ref: "Button",
      props: { variant: "outline" },
      children: [{ $ref: "Text", props: { children: "Add" } }],
    };
    expect(textToneDiagnostics(outline as never)).toEqual([]);
  });

  test("counts the app's own Button as a control", () => {
    const out = textToneDiagnostics(
      button({ $ref: "Text", props: { children: "Add" } }, true) as never,
    );
    expect(out).toHaveLength(1);
  });

  test("a Text that names its own color, or a size only, is judged correctly", () => {
    const colored = {
      $ref: "Text",
      props: { className: "text-primary-foreground", children: "Add" },
    };
    const sized = { $ref: "Text", props: { className: "text-sm", children: "Add" } };
    expect(textToneDiagnostics(button(colored) as never)).toEqual([]);
    expect(textToneDiagnostics(button(sized) as never)).toHaveLength(1);
  });

  test("a Text outside any control is left alone", () => {
    expect(textToneDiagnostics({ $ref: "Box", children: [{ $ref: "Text" }] } as never)).toEqual([]);
  });
});

/**
 * The Mantine eval: 38 bare `Text` nodes rendered Velloo's helper where the app
 * renders Mantine's. Write time warned only where a prop gave the intent away,
 * the capture called every component exact, and compare_to_url sent the agent
 * after paddings.
 */
describe("shadowedByVelloo", () => {
  function withCatalog(ctx: MutationContext, entries: Partial<RepoCatalogEntry>[]) {
    const full = entries.map(
      (entry) =>
        ({
          props: [],
          styleProps: [],
          identity: { importPath: "@mantine/core", exportName: entry.name ?? "" },
          ...entry,
        }) as RepoCatalogEntry,
    );
    ctx.repo = {
      catalog: async () => ({ entries: full }) as unknown as RepoCatalog,
    } as unknown as NonNullable<MutationContext["repo"]>;
    return ctx;
  }

  const tree = {
    $ref: "Box",
    children: [
      { $ref: "Text", props: { children: "a" } },
      { $ref: "Card", children: [{ $ref: "Text", props: { children: "b" } }] },
      { $ref: "Text", $repo: { importPath: "@mantine/core", exportName: "Text" } },
      { $ref: "Heading" },
    ],
  } as Node;

  test("counts the bare names the app's qualified components share, and nothing else", async () => {
    const { ctx } = await testContext();
    withCatalog(ctx, [
      { id: "Mantine.Text", name: "Text" },
      { id: "Mantine.Card", name: "Card" },
      // The app's own component that clashes with nothing keeps its bare id.
      { id: "Badge", name: "Badge" },
    ]);
    const uses = await shadowedByVelloo(ctx, screenWith(tree));
    // The node that already is the app's Text is not counted; Heading has no
    // counterpart in the app, so the helper is left alone.
    expect(uses).toEqual([
      { ref: "Text", appIds: ["Mantine.Text"], count: 2, path: [0] },
      { ref: "Card", appIds: ["Mantine.Card"], count: 1, path: [1] },
    ]);
    const [diagnostic, ...rest] = shadowedDiagnostics(uses);
    expect(rest).toEqual([]);
    expect(diagnostic?.code).toBe("repo/shadowed-by-velloo");
    expect(diagnostic?.severity).toBe("warning");
    expect(diagnostic?.message).toContain("3 nodes");
    expect(diagnostic?.message).toContain("Text ×2 → <Mantine.Text>, Card ×1 → <Mantine.Card>");
    expect(diagnostic?.suggestion).toContain("<Mantine.Text>");
  });

  // Giving 37 bare `Box` nodes Mantine's identity left a score at exactly
  // 0.9238: both are a div with the style they are given.
  test("a plain element the app also has is not a clash; components that draw differently are", async () => {
    const { ctx } = await testContext();
    withCatalog(ctx, [
      { id: "Mantine.Box", name: "Box" },
      { id: "Mantine.Text", name: "Text" },
      { id: "Mantine.Button", name: "Button" },
    ]);
    const uses = await shadowedByVelloo(
      ctx,
      screenWith({
        $ref: "Box",
        children: [
          { $ref: "Box", children: [{ $ref: "Text", props: { children: "a" } }] },
          { $ref: "Button", props: { children: "Go" } },
        ],
      } as Node),
    );
    expect(uses.map((use) => use.ref)).toEqual(["Button", "Text"]);
  });

  test("an extension of the shared name is the folder's choice, not a clash", async () => {
    const { ctx } = await testContext({
      config: { extensions: { Card: { importPath: "@/components/card", props: [] } } },
    });
    withCatalog(ctx, [{ id: "Mantine.Card", name: "Card" }]);
    expect(await shadowedByVelloo(ctx, screenWith(tree))).toEqual([]);
  });

  test("says nothing without an app catalog", async () => {
    const { ctx } = await testContext();
    expect(await shadowedByVelloo(ctx, screenWith(tree))).toEqual([]);
    expect(shadowedDiagnostics([])).toEqual([]);
  });
});

/**
 * An HTML design is drawn from the copies it keeps of the app's files, never
 * from the running app. An image it holds no copy of is a broken image on the
 * canvas and on a shared link, and nothing said so until someone looked.
 */
describe("an app image the design holds no copy of", () => {
  const tree: Node = {
    $ref: "Html",
    props: { as: "ul" },
    children: [
      { $ref: "Html", props: { as: "img", src: "/assets/trails/skyline/cover.svg" } },
      { $ref: "Html", props: { as: "img", src: "/static/logo.png" } },
      { $ref: "Html", props: { as: "img", src: "/assets/hero.png" } },
      { $ref: "Html", props: { as: "img", src: "https://cdn.example.com/a.png" } },
    ],
  };
  const PNG = "\u0089PNG";

  test("is named, with the tool that copies it in", async () => {
    const html = createHtmlProvider();
    const design = await testContext({
      provider: html,
      // The design's own upload, and one host file already stored.
      files: { "assets/hero.png": PNG, "assets/host/static/logo.png": PNG },
    });
    try {
      const found = await diagnosticsForScreen(design.ctx, undefined, screenWith(tree));
      const missing = found.filter((entry) => entry.code === "host/missing-file");
      expect(missing).toHaveLength(1);
      expect(missing[0]?.path).toEqual([0]);
      expect(missing[0]?.message).toContain("/assets/trails/skyline/cover.svg");
      // Held by the design, stored already, or not the app's at all.
      expect(missing[0]?.message).not.toContain("/static/logo.png");
      expect(missing[0]?.message).not.toContain("/assets/hero.png");
      expect(missing[0]?.message).not.toContain("cdn.example.com");
      expect(missing[0]?.suggestion).toContain("store_host_files");
    } finally {
      await design.cleanup();
    }
  });

  test("is no concern of a design that isn't drawn from the app's files", async () => {
    const design = await testContext();
    try {
      const found = await diagnosticsForScreen(
        design.ctx,
        undefined,
        screenWith({ $ref: "Image", props: { src: "/static/logo.png" } }),
      );
      expect(found.filter((entry) => entry.code === "host/missing-file")).toEqual([]);
    } finally {
      await design.cleanup();
    }
  });
});
