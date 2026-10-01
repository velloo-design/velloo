import { describe, expect, test } from "bun:test";
import { createProvider as createHtmlProvider } from "@velloo/provider-html";
import { repoKey, type Screen, type Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { DesignFolder } from "../../design-folder.ts";
import { HistoryManager } from "../../history.ts";
import type { RepoCatalog, RepoCatalogEntry } from "../../repo/catalog.ts";
import type { MutationContext } from "../index.ts";
import { dynamicIconWarningsForTree, propWarnings, propWarningsForTree } from "../prop-warnings.ts";

const provider = createShadcnProvider();

const screen: Screen = { id: "s", name: "S", tree: { $ref: "Card" } };

function ctxOf(): MutationContext {
  const folder: DesignFolder = {
    root: "/tmp",
    config: {
      schemaVersion: 4,
      name: "test",
      toolVersion: "test",
      libraries: {
        default: {
          id: "shadcn-upstream",
          version: "t",
          source: "binary",
          componentsPath: "binary",
        },
      },
      defaultLibrary: "default",
      viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
    },
    theme: {
      name: "t",
      colors: {
        background: "#fff",
        foreground: "#000",
        primary: { DEFAULT: "#000", foreground: "#fff" },
      },
      typography: {},
      spacing: {},
      radius: {},
    } as Theme,
    history: new HistoryManager(),
    customCss: "",
    themes: new Map(),
    screens: new Map([[screen.id, screen]]),
    boards: new Map(),
    snippets: new Map(),
    annotations: new Map(),
    notes: new Map(),
  };
  return {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: () => {},
  };
}

/**
 * A catalog holding the app's own components of names Velloo also has, so
 * they carry qualified ids — whatever the namespace (`Mantine.`, `App.`).
 */
function withAppComponents(ctx: MutationContext, entries: Partial<RepoCatalogEntry>[]) {
  const full = entries.map(
    (entry) =>
      ({
        styleProps: [],
        props: [],
        identity: { importPath: "@mantine/core", exportName: entry.name ?? "" },
        ...entry,
      }) as RepoCatalogEntry,
  );
  ctx.repo = {
    catalog: async () => ({ entries: full }) as unknown as RepoCatalog,
  } as unknown as NonNullable<MutationContext["repo"]>;
  return ctx;
}

const appProp = (name: string) => ({ name }) as RepoCatalogEntry["props"][number];

describe("a bare name the app shares with a Velloo component", () => {
  test("names the app's qualified component when it takes the unknown props", async () => {
    const ctx = withAppComponents(ctxOf(), [
      { id: "Mantine.Card", name: "Card", props: [appProp("withBorder"), appProp("radius")] },
    ]);
    const w = await propWarnings(ctx, screen, "Card", { withBorder: true, notAThing: 1 });
    expect(w[0]).toBe(
      "Card: unknown prop \"withBorder\" — `Card` is Velloo's own component; the app's is <Mantine.Card>, which takes withBorder. Write <Mantine.Card> for the app's.",
    );
    // A prop neither takes still gets the ordinary hint.
    expect(w.slice(1)).toEqual([expect.stringContaining('unknown prop "notAThing"')]);
  });

  test("works for the app's local namespace too", async () => {
    const ctx = withAppComponents(ctxOf(), [
      {
        id: "App.Field",
        name: "Field",
        identity: { importPath: "@/components/field", exportName: "Field" },
        props: [appProp("label"), appProp("hint")],
      },
    ]);
    const w = await propWarnings(ctx, screen, "Field", { label: "Berth", hint: "B-04" });
    expect(w).toEqual([expect.stringContaining('unknown props "label", "hint"')]);
    expect(w[0]).toContain("<App.Field>, which takes label, hint");
  });

  test("an app component that takes none of them changes nothing", async () => {
    const ctx = withAppComponents(ctxOf(), [
      { id: "Mantine.Card", name: "Card", props: [appProp("withBorder")] },
    ]);
    const w = await propWarnings(ctx, screen, "Card", { notAThing: 1 });
    expect(w).toEqual([expect.stringContaining('unknown prop "notAThing"')]);
    expect(w[0]).not.toContain("Mantine");
  });
});

describe("propWarnings", () => {
  test("flags a typo'd prop name with nearest-known suggestions", async () => {
    // The exact bug this exists for: Chart takes `kind`, not `type`.
    const w = await propWarnings(ctxOf(), screen, "Chart", { type: "bar" });
    expect(w.length).toBe(1);
    expect(w[0]).toContain('unknown prop "type"');
    expect(w[0]).toContain("kind");
  });

  test("flags enum values outside the declared set", async () => {
    const w = await propWarnings(ctxOf(), screen, "Button", { variant: "danger" });
    expect(w.length).toBe(1);
    expect(w[0]).toContain('"variant"');
    expect(w[0]).toContain("destructive");
  });

  test("accepts valid props, universal props, and data-/aria- passthroughs", async () => {
    const w = await propWarnings(ctxOf(), screen, "Button", {
      variant: "outline",
      className: "w-full",
      children: "Go",
      "data-testid": "cta",
      "aria-label": "Go",
    });
    expect(w).toEqual([]);
  });

  test("native Html accepts form, input and htmx attributes without false warnings", async () => {
    const ctx = ctxOf();
    const html = createHtmlProvider();
    ctx.providers.default = html;
    ctx.defaultProvider = html;
    expect(
      await propWarnings(ctx, screen, "Html", {
        as: "form",
        method: "get",
        action: "/desk/rows",
        "hx-get": "/desk/rows",
        "hx-target": "#ticket-results",
        placeholder: "Search tickets",
        name: "q",
        type: "search",
      }),
    ).toEqual([]);
  });

  test("skips $param/$if substitution values (snippet bodies)", async () => {
    const w = await propWarnings(ctxOf(), screen, "Button", {
      variant: { $if: "highlighted", then: "default", else: "outline" },
    });
    expect(w).toEqual([]);
  });

  test("flags a removed lucide brand glyph with an SVG/Image hint, not a bogus match", async () => {
    const w = await propWarnings(ctxOf(), screen, "Icon", { name: "Github" });
    expect(w.length).toBe(1);
    expect(w[0]).toContain('doesn\'t match any lucide icon — renders as the fallback "?"');
    expect(w[0]).toContain("brand glyphs");
    expect(w[0]).toContain("SVG");
    // Brand names skip the misleading nearest-match suggestion.
    expect(w[0]).not.toContain("closest:");
  });

  test("a plain typo'd icon name still suggests the closest real icon", async () => {
    const w = await propWarnings(ctxOf(), screen, "Icon", { name: "ArrowRiht" });
    expect(w.length).toBe(1);
    expect(w[0]).toContain("closest:");
  });

  test("a valid lucide name (either case) produces no warning", async () => {
    expect(await propWarnings(ctxOf(), screen, "Icon", { name: "ArrowRight" })).toEqual([]);
    expect(await propWarnings(ctxOf(), screen, "Icon", { name: "arrow-right" })).toEqual([]);
  });

  test("tree walk prefixes warnings with the node path", async () => {
    const w = await propWarningsForTree(ctxOf(), screen, {
      $ref: "Card",
      children: [
        { $ref: "Button", props: { variant: "danger" } },
        { $ref: "Chart", props: { type: "bar" } },
      ],
    });
    expect(w.length).toBe(2);
    expect(w[0]).toStartWith("[0] ");
    expect(w[1]).toStartWith("[1] ");
  });
});

describe("dynamicIconWarningsForTree", () => {
  test("an icon param wired into Icon `name` warns, path-prefixed, pointing at a node param", () => {
    const w = dynamicIconWarningsForTree({
      $ref: "Box",
      children: [
        { $ref: "Heading", props: { children: { $param: "title" } } },
        { $ref: "Icon", props: { name: { $param: "priorityIcon" } } },
      ],
    });
    expect(w.length).toBe(1);
    expect(w[0]).toStartWith("[1] ");
    expect(w[0]).toContain('param "priorityIcon"');
    expect(w[0]).toContain("single static glyph");
    expect(w[0]).toContain("`node` param");
  });

  test("a literal icon name yields no warning", () => {
    expect(
      dynamicIconWarningsForTree({
        $ref: "Box",
        children: [{ $ref: "Icon", props: { name: "ArrowRight" } }],
      }),
    ).toEqual([]);
  });

  test("a node-type param used as a child slot yields no warning", () => {
    expect(
      dynamicIconWarningsForTree({
        $ref: "Box",
        children: [{ $param: "icon" }, { $ref: "Text", props: { children: { $param: "label" } } }],
      }),
    ).toEqual([]);
  });

  test("finds an $if-driven Icon inside a node-shaped `children` prop", () => {
    const w = dynamicIconWarningsForTree({
      $ref: "Button",
      props: {
        children: {
          $ref: "Icon",
          props: { name: { $if: "done", then: "Check", else: "Circle" } },
        },
      },
    });
    expect(w.length).toBe(1);
    expect(w[0]).toContain('$if on "done"');
  });
});

describe("a slot prop given markup as a string", () => {
  const identity = { importPath: "@mantine/core", exportName: "TextInput" };
  function withTextInput(): MutationContext {
    const ctx = ctxOf();
    const entry = {
      id: "TextInput",
      name: "TextInput",
      identity,
      styleProps: ["style"],
      props: [
        {
          name: "rightSection",
          type: "React.ReactNode",
          control: "string",
          optional: true,
          slot: true,
          serializable: true,
        },
        { name: "label", type: "string", control: "string", optional: true, serializable: true },
      ],
    } as unknown as RepoCatalogEntry;
    ctx.repo = {
      catalog: async () =>
        ({
          entries: [entry],
          byKey: new Map([[repoKey(identity), entry]]),
        }) as unknown as RepoCatalog,
    } as unknown as NonNullable<MutationContext["repo"]>;
    return ctx;
  }

  test("says it renders literally and how to pass an element", async () => {
    const w = await propWarnings(
      withTextInput(),
      screen,
      "TextInput",
      { rightSection: '<Badge color="red">3</Badge>' },
      identity,
    );
    expect(w).toEqual([expect.stringContaining('"rightSection" got the string')]);
    expect(w[0]).toContain("renders as literal text");
    expect(w[0]).toContain("rightSection={<Badge …/>}");
  });

  test("leaves plain text in a slot, and markup-looking text in a string prop, alone", async () => {
    const ctx = withTextInput();
    expect(
      await propWarnings(
        ctx,
        screen,
        "TextInput",
        { rightSection: "kg", label: "<b>x</b>" },
        identity,
      ),
    ).toEqual([]);
    expect(
      await propWarnings(ctx, screen, "TextInput", { rightSection: "a < b" }, identity),
    ).toEqual([]);
  });
});
