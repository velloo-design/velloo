import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { DesignBundleSchema, FrozenScreenSchema } from "@velloo/protocol/publish";
import { chromiumExecutable } from "@velloo/renderer";
import { fixtureApp } from "../../../server/src/repo/__tests__/fixture-app.ts";
import { designConfig, scaffoldDesignFolder } from "../../../server/src/testing/design-folder.ts";

setDefaultTimeout(120_000);

/**
 * What a publish has to carry for the share to be the canvas.
 *
 * The cloud renders a share from the bundle and has none of the app's code. So
 * two things that reach the canvas through the app's own bundle have to travel
 * as data instead: its stylesheet, and — for a screen that uses the app's own
 * components — the DOM those components produced when they were mounted here.
 * This runs the real command (`--to` writes the bundle to a directory through
 * the same upload path) on an app with real components and reads what came
 * out. velloo-cloud's share-parity e2e then holds the viewer to it, pixel for
 * pixel.
 */

const hasChromium = (await chromiumExecutable()) !== null;
const cliPath = resolve(import.meta.dir, "../cli.ts");

const repo = (exportName: string) => ({ importPath: "./src/components", exportName });

describe.if(hasChromium)("velloo publish --to (chromium)", () => {
  let app: Awaited<ReturnType<typeof fixtureApp>>;
  let folder: Awaited<ReturnType<typeof scaffoldDesignFolder>>;
  let out: string;
  let log = "";

  beforeAll(async () => {
    app = await fixtureApp();
    folder = await scaffoldDesignFolder({
      label: "publish-parity",
      config: designConfig({
        library: { id: "none", version: "t", source: "binary", componentsPath: "binary" },
        styling: { framework: "none" },
        hostApp: { root: app.root },
      }),
      // A dark palette: the viewer offers its dark switch, so dark is frozen too.
      theme: { colorsDark: { background: "oklch(0.2 0 0)", foreground: "oklch(0.95 0 0)" } },
      screens: {
        components: {
          id: "components",
          name: "Components",
          tree: {
            $ref: "Box",
            children: [
              {
                $ref: "StatCard",
                $repo: repo("StatCard"),
                props: { label: "Uptime", value: "99.9%", tone: "positive" },
              },
              {
                $ref: "Box",
                props: { as: "p" },
                children: [
                  { $text: "Deployed " },
                  { $ref: "Box", props: { as: "b", children: "now" } },
                ],
              },
            ],
          },
        },
        plain: {
          id: "plain",
          name: "Plain",
          tree: { $ref: "Box", props: { as: "section", className: "fx-card", children: "Plain" } },
        },
      },
    });
    const toApp = relative(folder.root, app.root);
    await folder.write(
      "preview.jsx",
      [
        `import ${JSON.stringify(join(toApp, "src/styles.css"))};`,
        'import "./library.css";',
        // What a component library's provider does: mark the root, and style from the mark.
        'document.documentElement.setAttribute("data-fixture-scheme", "on");',
        "export default function Preview({ children }) {",
        "  return <>{children}</>;",
        "}",
      ].join("\n"),
    );
    // A component library's stylesheet: long, and the same on every screen.
    await folder.write(
      "library.css",
      Array.from({ length: 120 }, (_, i) => `.lib-${i} { padding: ${i}px; margin: ${i}px; }`).join(
        "\n",
      ),
    );
    out = await mkdtemp(join(tmpdir(), "velloo-publish-parity-"));
    const run = Bun.spawn(["bun", cliPath, "publish", folder.root, "--to", out], {
      stdout: "pipe",
      stderr: "pipe",
    });
    log = `${await new Response(run.stdout).text()}${await new Response(run.stderr).text()}`;
    expect(await run.exited, log).toBe(0);
  });

  afterAll(async () => {
    await rm(out, { recursive: true, force: true });
    await folder?.cleanup();
    await app?.cleanup();
  });

  const design = async () =>
    DesignBundleSchema.parse(JSON.parse(await readFile(join(out, "design.json"), "utf8")));

  test("nothing is uploaded, and the bundle is the one the cloud would store", async () => {
    expect(log).toContain("nothing was uploaded");
    expect(log).not.toContain("will not match the canvas");
    const doc = await design();
    expect(doc.formatVersion).toBe(2);
    expect(doc.screens.map((screen) => screen.id).sort()).toEqual(["components", "plain"]);
    // A text node travels as a text node: the viewer draws it bare, as here.
    expect(JSON.stringify(doc.screens)).toContain('{"$text":"Deployed "}');
  });

  test("the app's stylesheet ships once, for every screen it styles", async () => {
    const doc = await design();
    const sheet = doc.appStylesheets?.plain;
    expect(sheet).toMatch(/^app-[a-z0-9]+\.css$/);
    expect(doc.appStylesheets?.components).toBe(sheet as string);
    expect(await readFile(join(out, sheet as string), "utf8")).toContain(".fx-card");
    expect((await readdir(out)).filter((name) => name.startsWith("app-"))).toHaveLength(1);
  });

  test("a screen with the app's components ships as the DOM they mounted to", async () => {
    const doc = await design();
    const variants = doc.frozenScreens?.components ?? {};
    expect(Object.keys(variants).sort()).toEqual(["default/dark", "default/light"]);
    const frozen = FrozenScreenSchema.parse(
      JSON.parse(await readFile(join(out, variants["default/light"] as string), "utf8")),
    );
    // The real component's own markup, not the dashed frame that stands in for it.
    expect(frozen.body).toContain('data-tone="positive"');
    expect(frozen.body).toContain("99.9%");
    // Still addressable: comments anchor to these, and the text run to its parent.
    expect(frozen.body).toMatch(/data-node-path="0"/);
    expect(frozen.body).toMatch(/<p[^>]*data-node-text="0"[^>]*>Deployed <b/);
    // What the app's code put on the root travels: stylesheets key off it.
    expect(frozen.htmlAttributes["data-fixture-scheme"]).toBe("on");
    // The stylesheets the canvas had, and nothing that runs.
    const sheets = await Promise.all(
      frozen.head.map(async (style) =>
        style.file ? readFile(join(out, style.file), "utf8") : (style.css ?? ""),
      ),
    );
    expect(sheets.join("\n")).toContain(".fx-card");
    expect(sheets.join("\n")).toContain(".lib-119");
    expect(frozen.head.every((style) => style.tag === "style" || style.tag === "link")).toBe(true);
    expect(JSON.stringify(frozen)).not.toContain("<script");
    // Plain markup renders from its tree on the share: it needs no frozen copy.
    expect(doc.frozenScreens?.plain).toBeUndefined();
  });

  test("a stylesheet every frozen screen has ships once, not inside each of them", async () => {
    const doc = await design();
    const variants = doc.frozenScreens?.components ?? {};
    const heads = await Promise.all(
      ["default/light", "default/dark"].map(
        async (variant) =>
          FrozenScreenSchema.parse(
            JSON.parse(await readFile(join(out, variants[variant] as string), "utf8")),
          ).head,
      ),
    );
    const filesOf = (head: (typeof heads)[number]) =>
      head.flatMap((style) => (style.file ? [style.file] : []));
    const [light, dark] = heads.map(filesOf);
    expect(light?.length).toBeGreaterThan(0);
    expect(dark).toEqual(light as string[]);
    // The app's stylesheet is already in the bundle under its own name: the
    // frozen screens point at that file instead of carrying a second copy.
    expect(light).toContain(doc.appStylesheets?.components as string);
    const frozenDir = await readdir(join(out, "frozen"));
    expect(frozenDir.filter((name) => name.endsWith(".json"))).toHaveLength(2);
    for (const name of frozenDir.filter((file) => file.endsWith(".json"))) {
      expect(await readFile(join(out, "frozen", name), "utf8")).not.toContain(".lib-119");
    }
  });

  test("the preview is the picture of the page that was frozen", async () => {
    const doc = await design();
    expect(doc.screenshots?.screens.components).toBe("screenshots/components.png");
    const png = await readFile(join(out, "screenshots/components.png"));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });
});
