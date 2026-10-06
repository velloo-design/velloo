import { afterEach, describe, expect, test } from "bun:test";
import { captureScreenshot, chromiumExecutable, closePooledBrowser } from "@velloo/renderer";
import type { Screen } from "@velloo/schema";
import { renderForCapture } from "../mcp/tools/screenshot-helpers.ts";
import { createRepoComponents } from "../repo/store.ts";
import { type TestContext, testContext } from "../testing/design-folder.ts";

/**
 * A screen of plain markup written against the app's own classes, with none of
 * the app's components on it. Nothing mounts, so the only way the app's
 * stylesheet reaches the capture is in the server-rendered document — which is
 * where it used to be missing, leaving a hero exploration unstyled.
 */

const hasChromium = (await chromiumExecutable()) !== null;

const hero: Screen = {
  id: "home",
  name: "Home",
  tree: {
    $ref: "Box",
    props: { as: "section", className: "hero" },
    children: [{ $ref: "Box", props: { as: "h1", children: "Outcomes" } }],
  },
};

let design: TestContext | undefined;
afterEach(async () => {
  await closePooledBrowser();
  await design?.cleanup();
  design = undefined;
});

describe.if(hasChromium)("the app's stylesheet in a capture (chromium)", () => {
  test("styles a screen that mounts none of the app's components", async () => {
    design = await testContext({
      nested: true,
      screens: { home: hero },
      files: {
        "preview.tsx": `import "../styles/globals.css";\n\nexport default function Preview({ children }: { children: React.ReactNode }) {\n  return <>{children}</>;\n}\n`,
        "../styles/globals.css": `@import "./tokens.css";\n.hero { background: var(--brand); padding: 40px; }\n`,
        "../styles/tokens.css": ":root { --brand: rgb(102, 51, 153); }\n",
      },
    });
    const ctx = { ...design.ctx, repo: createRepoComponents(design.folder, design.ctx.providers) };
    const html = await renderForCapture(ctx, hero, {
      theme: design.folder.theme,
      dark: false,
      viewport: { w: 600, h: 400 },
      snapshotCss: "",
      liveUrl: () => undefined,
      canvasBundle: async () => undefined,
    });
    const capture = await captureScreenshot({ html, viewport: { w: 600, h: 400 }, dom: true });
    const section = capture.dom?.nodes.find((node) => node.tag === "section");
    expect(section?.style.backgroundColor).toBe("rgb(102, 51, 153)");
    expect(section?.style.padding).toBe("40px");
  }, 60_000);
});
