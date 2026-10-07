import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createProvider } from "@velloo/provider-none";
import { renderScreen } from "@velloo/renderer";
import type { Screen, Theme, Viewport } from "@velloo/schema";
import { type Browser, chromium, type Page } from "playwright-core";
import { registryForScreen } from "../extensions/registry.ts";

/**
 * A `Text` inside a `Text`, after a browser has parsed the server's markup.
 *
 * "Skyline Loop <Text>12 km</Text> with <Text>moderate</Text> climbs" is one
 * line of copy with two styled runs. When both `Text`s were `<p>`, the parser
 * ended the outer paragraph at the first inner one: the runs and the text
 * between them became children of the row instead, and a flex row with a 20px
 * gap laid one line out as five spaced items. Only the reparsed path saw it —
 * a mounted canvas and a shared link nest whatever React tells them to — so a
 * screenshot and the canvas disagreed about the same design.
 *
 * Opt-in (needs `velloo browser install`): `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";

const theme: Theme = {
  name: "t",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.5 0.2 250)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};
const viewport: Viewport = { w: 800, h: 300 };

const screen: Screen = {
  id: "s",
  name: "S",
  library: "none",
  tree: {
    $ref: "Box",
    props: { style: { display: "flex", alignItems: "center", gap: "20px", padding: "16px" } },
    children: [
      { $ref: "Box", props: { style: { flex: "none", width: "120px", height: "90px" } } },
      {
        $ref: "Text",
        props: { style: { margin: 0, fontSize: "17px", fontWeight: 600 } },
        children: [
          { $text: "Skyline Loop " },
          {
            $ref: "Text",
            props: { style: { display: "inline", fontWeight: 700, margin: 0 }, children: "12 km" },
          },
          { $text: " with " },
          {
            $ref: "Text",
            props: {
              style: { display: "inline-block", padding: "2px 10px", margin: 0 },
              children: "moderate",
            },
          },
          { $text: " climbs" },
        ],
      },
    ],
  },
};

const none = createProvider();

describe.skipIf(!RUN)("a Text inside a Text survives the HTML parser (Playwright)", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: viewport.w, height: viewport.h } });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  // Both of the no-library provider's `Text`s: the Tailwind-classed helper every
  // provider reuses, and the inline-styled one a `none/none` folder renders.
  for (const css of ["tailwind", "none"] as const) {
    test(`${css}: the runs stay inside the paragraph, on its one line`, async () => {
      const { html } = await renderScreen(screen, theme, {
        viewport,
        snapshotCss: "",
        registry: registryForScreen(screen, { none }, none, {}, css),
      });
      await page.setContent(html, { waitUntil: "load" });

      const parsed = await page.evaluate(() => {
        const at = (path: string) =>
          document.querySelector(`[data-node-path="${path}"]`) as HTMLElement;
        const row = at("");
        const line = at("1");
        const runs = [at("1.1"), at("1.3")];
        const first = runs[0] as HTMLElement;
        // The text before the first run, measured as glyphs.
        const range = document.createRange();
        range.selectNodeContents(line.firstChild as Node);
        const lead = range.getBoundingClientRect();
        return {
          rowChildren: [...row.children].map((el) => el.getAttribute("data-node-path")),
          lineTag: line.tagName,
          lineText: line.textContent,
          runTags: runs.map((el) => el.tagName),
          runParents: runs.map((el) => el.parentElement?.getAttribute("data-node-path")),
          paragraphs: document.querySelectorAll("p").length,
          gapBeforeFirstRun: first.getBoundingClientRect().left - lead.right,
          lineHeight: line.getBoundingClientRect().height,
          runHeight: first.getBoundingClientRect().height,
        };
      });

      expect(parsed.lineTag).toBe("P");
      expect(parsed.runTags).toEqual(["SPAN", "SPAN"]);
      expect(parsed.runParents).toEqual(["1", "1"]);
      expect(parsed.lineText).toBe("Skyline Loop 12 km with moderate climbs");
      // The row holds the tile and the line — not the line's pieces.
      expect(parsed.rowChildren).toEqual(["0", "1"]);
      // Split, the line is four: its start, each run, and the empty one its
      // stray end tag makes.
      expect(parsed.paragraphs).toBe(1);
      // The run follows its text at a word's distance, not the row's 20px gap.
      expect(parsed.gapBeforeFirstRun).toBeLessThan(8);
      expect(parsed.lineHeight).toBeLessThan(parsed.runHeight * 2);
    });
  }
});
