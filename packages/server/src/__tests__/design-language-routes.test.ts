import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createProvider as createNoneProvider } from "@velloo/provider-none";
import type { Theme } from "@velloo/schema";
import { createApp } from "../app.ts";
import type { DesignRulesState } from "../design-rules.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";
import {
  designBoard,
  designTheme,
  type TestContext,
  type TestContextOptions,
  testContext,
} from "../testing/design-folder.ts";

/**
 * The design-language stage as the canvas reaches it: what it reads on entry,
 * the edits it makes live, and Cancel — which has to put back the theme and
 * the rules it found, including the case where it found none.
 */

let t: TestContext;
let app: ReturnType<typeof createApp>;

async function open(options: TestContextOptions = {}): Promise<void> {
  t = await testContext({ label: "language-routes", nested: true, ...options });
  const { ctx, root } = t;
  app = createApp(
    () => ctx,
    new TailwindJit(ctx.defaultProvider, join(root, "screens")),
    new LiveBundler(
      root,
      () => ctx.folder.config,
      () => liveExtensions(ctx.folder.config.extensions),
    ),
    new CanvasBundler(
      root,
      () => ctx.folder.config.hostApp,
      () => undefined,
    ),
  );
}

afterEach(() => t.cleanup());

const get = (path: string): Promise<Response> =>
  Promise.resolve(app.fetch(new Request(`http://localhost${path}`)));
const post = (path: string, body: unknown): Promise<Response> =>
  Promise.resolve(
    app.fetch(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  );
const themeOnDisk = async (name = "default") =>
  JSON.parse(await readFile(join(t.root, "theme", `${name}.json`), "utf8")) as Theme;
const guidance = () => readFile(join(t.root, "guidance.md"), "utf8");

const RULES = {
  intent: "Calm and dense.",
  rules: [
    { kind: "do" as const, text: "One accent per screen" },
    { kind: "dont" as const, text: "Shadows on flat surfaces" },
  ],
};

describe("GET /api/design-language", () => {
  test("a design that follows no document has no rules, and no slots a framework insists on", async () => {
    await open();
    const body = (await (await get("/api/design-language")).json()) as {
      rules: DesignRulesState;
      frameworkRoles: string[] | null;
    };
    expect(body.rules).toEqual({ source: null, intent: "", rules: [] });
    expect(body.frameworkRoles).toBeNull();
  });

  test("names the colour slots the design's own framework reads", async () => {
    await open({
      provider: createNoneProvider(),
      config: { library: { id: "none" }, styling: { framework: "none" } },
    });
    const body = (await (await get("/api/design-language")).json()) as {
      frameworkRoles: string[] | null;
    };
    expect(body.frameworkRoles).toEqual(createNoneProvider().themeRoles as string[]);
    expect(body.frameworkRoles).toContain("border");
  });
});

describe("POST /api/design-language/rules", () => {
  test("saves the rules to guidance.md and answers with what the folder now follows", async () => {
    await open();
    const res = await post("/api/design-language/rules", RULES);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      rules: { source: { path: "guidance.md", writable: true }, ...RULES },
    });
    expect(await guidance()).toContain("- Don't: Shadows on flat surfaces");
    // The next read is the saved file, not what the request carried.
    const read = (await (await get("/api/design-language")).json()) as { rules: DesignRulesState };
    expect(read.rules.rules).toEqual(RULES.rules);
  });

  test("a rule with no text is refused before anything is written", async () => {
    await open();
    const res = await post("/api/design-language/rules", {
      intent: "x",
      rules: [{ kind: "do", text: "" }],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { kind: string } }).error.kind).toBe("BadRequest");
    await expect(guidance()).rejects.toThrow();
  });
});

describe("POST /api/design-language/restore (Cancel)", () => {
  test("puts back the theme and takes out the rules a first visit wrote", async () => {
    await open();
    const before = structuredClone(t.ctx.folder.theme);
    await post("/api/theme/set_token", { path: "colors.background", value: "oklch(0.2 0 0)" });
    await post("/api/design-language/rules", RULES);

    const res = await post("/api/design-language/restore", { theme: before, rules: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rules: { source: null, intent: "", rules: [] } });
    expect((await themeOnDisk()).colors.background).toBe(before.colors.background);
    // The file existed only for this visit, so it goes with the rules.
    await expect(guidance()).rejects.toThrow();
  });

  test("restores the rules that were there on entry", async () => {
    await open();
    await post("/api/design-language/rules", RULES);
    await post("/api/design-language/rules", { intent: "Loud.", rules: [] });

    const res = await post("/api/design-language/restore", { rules: RULES });
    expect(((await res.json()) as { rules: DesignRulesState }).rules).toMatchObject(RULES);
  });

  test("the theme alone, for a design whose rules are the repo's and were never the stage's to change", async () => {
    await open();
    await post("/api/design-language/rules", RULES);
    const before = structuredClone(t.ctx.folder.theme);
    await post("/api/theme/set_radius", { value: "1rem" });

    const res = await post("/api/design-language/restore", { theme: before });
    expect(res.status).toBe(200);
    // No `rules` in the body: they are reported as they stand and left alone.
    expect(((await res.json()) as { rules: DesignRulesState }).rules).toMatchObject(RULES);
    expect((await themeOnDisk()).radius).toEqual(before.radius);
  });

  test("restores the named theme the stage was on, and leaves the default alone", async () => {
    const ember = designTheme({
      name: "ember",
      colors: { background: "oklch(0.98 0.01 60)" },
    });
    await open({ themes: { ember } });
    await post("/api/theme/set_token", {
      path: "colors.background",
      value: "oklch(0.3 0 0)",
      theme: "ember",
    });
    const defaultBefore = await themeOnDisk();

    const res = await post("/api/design-language/restore", { theme: ember, name: "ember" });
    expect(res.status).toBe(200);
    expect((await themeOnDisk("ember")).colors.background).toBe("oklch(0.98 0.01 60)");
    expect(await themeOnDisk()).toEqual(defaultBefore);
  });

  test("a theme that is not there is refused by name, with the rules untouched", async () => {
    await open();
    await post("/api/design-language/rules", RULES);
    const res = await post("/api/design-language/restore", {
      theme: t.ctx.folder.theme,
      name: "gone",
      rules: null,
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('Unknown theme \\"gone\\"');
    expect(await guidance()).toContain("One accent per screen");
  });
});

describe("the stage's theme controls over /api/theme", () => {
  test("starting points are offered with enough to draw each card, none lit on a theme that is none of them", async () => {
    await open();
    const body = (await (await get("/api/theme/starting-points")).json()) as {
      startingPoints: Record<string, unknown>[];
      active: string | null;
    };
    expect(body.active).toBeNull();
    const ember = body.startingPoints.find((point) => point.id === "ember");
    // A direction with a display face shows that face, not its body one.
    expect(ember).toEqual({
      id: "ember",
      name: "Ember",
      note: "Burnt orange · DM Serif + DM Sans · 12px",
      primary: "#c2410c",
      font: '"DM Serif Display", ui-serif, Georgia, serif',
      radius: 12,
    });
    const cobalt = body.startingPoints.find((point) => point.id === "cobalt");
    expect(cobalt?.font).toContain("Inter");
  });

  test("a card is lit once applied, on that theme only, and goes dark at the first change", async () => {
    await open({ themes: { variant: designTheme({ name: "variant" }) } });
    const active = async (name?: string) =>
      (
        (await (await get(`/api/theme/starting-points${name ? `?name=${name}` : ""}`)).json()) as {
          active: string | null;
        }
      ).active;

    expect((await post("/api/theme/apply_starting_point", { id: "moss" })).status).toBe(200);
    expect(await active()).toBe("moss");
    expect(await active("variant")).toBeNull();

    await post("/api/theme/set_radius", { value: "0.75rem" });
    expect(await active()).toBeNull();
  });

  test("a starting point that does not exist is a 404 naming the ones that do", async () => {
    await open();
    const before = await themeOnDisk();
    const res = await post("/api/theme/apply_starting_point", { id: "neon" });
    expect(res.status).toBe(404);
    const { error } = (await res.json()) as { error: { kind: string } };
    expect(error.kind).toBe("UnknownPreset");
    expect(JSON.stringify(error)).toContain("ink, cobalt, ember");
    expect(await themeOnDisk()).toEqual(before);
  });

  test("a dark pair lands in one write, or not at all", async () => {
    await open();
    const pair = [
      { path: "colorsDark.primary.DEFAULT", value: "oklch(0.8 0.1 280)" },
      { path: "colorsDark.primary.foreground", value: "oklch(0.2 0 0)" },
    ];
    const res = await post("/api/theme/set_tokens", { entries: pair });
    expect(res.status).toBe(200);
    expect((await themeOnDisk()).colorsDark?.primary).toEqual({
      DEFAULT: "oklch(0.8 0.1 280)",
      foreground: "oklch(0.2 0 0)",
    });
    // One write is one refresh of the canvas, not a flash of half a pair.
    expect(t.events.filter((event) => event.type === "theme-changed")).toHaveLength(1);

    // One bad entry and neither is written: the good half alone would be the
    // invalid in-between the route exists to avoid.
    const before = await themeOnDisk();
    const refused = await post("/api/theme/set_tokens", {
      entries: [
        { path: "colorsDark.card.DEFAULT", value: "oklch(0.3 0 0)" },
        { path: "colorsDark.primry.foreground", value: "oklch(0.9 0 0)" },
      ],
    });
    expect(refused.status).toBe(400);
    const { error } = (await refused.json()) as {
      error: { kind: string; applied: string[]; failed: { path: string }[] };
    };
    expect(error.kind).toBe("BulkTokensInvalid");
    expect(error.failed.map((entry) => entry.path)).toEqual(["colorsDark.primry.foreground"]);
    expect(await themeOnDisk()).toEqual(before);
  });

  test("the corner control replaces the scale and keeps a pill radius", async () => {
    await open({ theme: { radius: { sm: "2px", md: "6px", xl: "20px", full: "9999px" } } });
    const res = await post("/api/theme/set_radius", { value: "0.5rem" });
    expect(res.status).toBe(200);
    // Steps left from another base would keep rounded-sm and rounded-xl where they were.
    expect((await themeOnDisk()).radius).toEqual({ full: "9999px", md: "0.5rem" });
    expect(t.events.some((event) => event.type === "theme-changed")).toBe(true);
  });

  test("a colour role of the design's own is added light and dark together, recoloured, and removed", async () => {
    await open();
    const added = await post("/api/theme/set_role", { name: "success", light: "#15803d" });
    expect(added.status).toBe(200);
    expect(await themeOnDisk()).toMatchObject({
      palette: { success: "#15803d" },
      paletteDark: { success: "#15803d" },
    });

    await post("/api/theme/set_role", { name: "success", dark: "#4ade80" });
    expect(await themeOnDisk()).toMatchObject({
      palette: { success: "#15803d" },
      paletteDark: { success: "#4ade80" },
    });

    await post("/api/theme/set_role", { name: "success", remove: true });
    const removed = await themeOnDisk();
    expect(removed.palette).toBeUndefined();
    expect(removed.paletteDark).toBeUndefined();
  });

  test("a role cannot take a semantic slot's name, go without a light colour, or have a name that is not a utility", async () => {
    await open();
    const taken = await post("/api/theme/set_role", { name: "primary", light: "#000" });
    expect(taken.status).toBe(400);
    expect(JSON.stringify(await taken.json())).toContain("already one of the theme's own roles");

    // A new role with only its dark colour would have nothing to show in light mode.
    const halved = await post("/api/theme/set_role", { name: "success", dark: "#4ade80" });
    expect(halved.status).toBe(400);
    expect(JSON.stringify(await halved.json())).toContain("needs a light colour");

    const shaped = await post("/api/theme/set_role", { name: "Brand Blue", light: "#00f" });
    expect(shaped.status).toBe(400);
    expect(((await shaped.json()) as { error: { kind: string } }).error.kind).toBe("BadRequest");
    expect((await themeOnDisk()).palette).toBeUndefined();
  });

  test("a draft theme is removed on Cancel, but not while a board renders with it", async () => {
    await open({
      screens: { home: true },
      boards: { main: designBoard("main", ["home"], { theme: "draft" }) },
      themes: { draft: designTheme({ name: "draft" }) },
    });
    const pinned = await post("/api/theme/remove_theme", { name: "draft" });
    expect(pinned.status).toBe(400);
    expect(JSON.stringify(await pinned.json())).toContain("pinned by main");
    expect((await themeOnDisk("draft")).name).toBe("draft");

    await post("/api/mutate/update_board", { boardId: "main", patch: { theme: null } });
    const removed = await post("/api/theme/remove_theme", { name: "draft" });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ removedTheme: "draft" });
    await expect(themeOnDisk("draft")).rejects.toThrow();
  });
});

describe("GET /api/render/specimen", () => {
  const specimen = async (query = "") => {
    const res = await get(`/api/render/specimen${query}`);
    return { status: res.status, html: await res.text() };
  };

  test("renders the design language on the folder's own components, with its classes compiled", async () => {
    await open();
    const { status, html } = await specimen();
    expect(status).toBe(200);
    expect(html).toContain("Design language");
    expect(html).toContain("A first-level heading sets the voice");
    expect(html).toContain('data-slot="button"');
    // The tree exists only in memory, so no file told the JIT about its
    // classes: a rule for one only the specimen uses proves they were handed over.
    expect(html).toMatch(/\.grid-cols-6\s*\{/);
    // Nothing about asking for it changes the design.
    expect(t.ctx.folder.screens.size).toBe(0);
    expect(t.events).toEqual([]);
  });

  test("draws the theme it is asked for: a role only that theme defines is on it", async () => {
    await open({
      themes: {
        ember: { ...designTheme({ name: "ember" }), palette: { "brand-ember": "#c2410c" } },
      },
    });
    expect((await specimen()).html).not.toContain("brand-ember");
    expect((await specimen("?theme=ember")).html).toContain("brand-ember");
  });
});
