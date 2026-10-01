import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { FrameworkAdapter } from "@velloo/provider";
import { createProvider as createAntd } from "@velloo/provider-antd";
import { createProvider as createMui } from "@velloo/provider-mui";
import { renderScreen } from "@velloo/renderer";
import type { Node, Screen, Theme } from "@velloo/schema";
import { type Browser, chromium } from "playwright-core";

/**
 * antd and MUI style only their own components, and their style channels skip
 * the Tailwind JIT, so a plain element in their frames used to fall through to
 * the browser default (Times, 16px, black, content-box). Their apps get a
 * global reset (antd's reset.css, MUI's CssBaseline). This loads each adapter's real SSR
 * in chromium and reads what a plain element actually computes. Opt-in:
 * `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";

const theme: Theme = {
  name: "t",
  colors: {
    background: "#f6f7fb",
    foreground: "#1f2430",
    primary: { DEFAULT: "#4f46e5", foreground: "#ffffff" },
  },
  colorsDark: { background: "#0b0b0f", foreground: "#f5f5f5" },
  typography: {
    fontFamily: { sans: "Inter, sans-serif" },
    typesets: { default: { size: 14 } },
  },
  spacing: { 1: 4 },
  radius: { md: 8 },
};

const plain: Node = { $ref: "Box", props: { id: "plain", children: "loose text" } };
// A sized, padded container: border-box keeps it at its stated width.
const sized: Node = {
  $ref: "Box",
  props: { id: "sized", style: { width: 200, padding: 24 } },
};

const cases: { name: string; adapter: FrameworkAdapter; tree: Node }[] = [
  {
    name: "antd",
    adapter: createAntd(),
    tree: {
      $ref: "Flex",
      props: { vertical: true, gap: 8 },
      children: [plain, sized, { $ref: "Button", props: { type: "primary", children: "Go" } }],
    },
  },
  {
    name: "MUI",
    adapter: createMui(),
    tree: {
      $ref: "Stack",
      props: { spacing: 1 },
      children: [plain, sized, { $ref: "Button", props: { variant: "contained", children: "Go" } }],
    },
  },
];

describe.skipIf(!RUN)("adapter document baseline (Playwright)", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(() => browser?.close());

  async function computed(adapter: FrameworkAdapter, tree: Node, dark: boolean) {
    const screen: Screen = { id: "s", name: "S", tree };
    const { html } = await renderScreen(screen, theme, {
      viewport: { w: 400, h: 300 },
      snapshotCss: "",
      registry: adapter.registry,
      renderPass: adapter.renderPass?.(theme, dark),
      includeRuntime: false,
      dark,
    });
    const page = await browser.newPage();
    try {
      await page.setContent(html);
      return await page.evaluate(() => {
        const el = document.getElementById("plain");
        const box = document.getElementById("sized");
        if (!el || !box) return null;
        const s = getComputedStyle(el);
        return {
          fontFamily: s.fontFamily,
          fontSize: s.fontSize,
          color: s.color,
          background: getComputedStyle(document.body).backgroundColor,
          boxSizing: s.boxSizing,
          sizedWidth: box.getBoundingClientRect().width,
          bodyMargin: getComputedStyle(document.body).margin,
        };
      });
    } finally {
      await page.close();
    }
  }

  async function antdLineHeight(t: Theme): Promise<string | null> {
    const [antd] = cases;
    if (!antd) throw new Error("no antd case");
    const page = await browser.newPage();
    try {
      const { html } = await renderScreen({ id: "s", name: "S", tree: antd.tree }, t, {
        viewport: { w: 400, h: 300 },
        snapshotCss: "",
        registry: antd.adapter.registry,
        renderPass: antd.adapter.renderPass?.(t),
        includeRuntime: false,
      });
      await page.setContent(html);
      return await page.evaluate(() => {
        const el = document.getElementById("plain");
        return el ? getComputedStyle(el).lineHeight : null;
      });
    } finally {
      await page.close();
    }
  }

  test("antd: plain text takes antd's derived line height on velloo's default leading", async () => {
    // antd on 14px: 14 * (22 / 14).
    expect(await antdLineHeight(theme)).toBe("22px");
  });

  test("antd: plain text takes a leading the user chose", async () => {
    const chosen: Theme = {
      ...theme,
      typography: { ...theme.typography, typesets: { default: { size: 14, leading: 1.5 } } },
    };
    expect(await antdLineHeight(chosen)).toBe("21px");
  });

  for (const { name, adapter, tree } of cases) {
    test(`${name}: a plain element inherits the theme's type and color, on border-box`, async () => {
      expect(await computed(adapter, tree, false)).toEqual({
        fontFamily: "Inter, sans-serif",
        fontSize: "14px",
        color: "rgb(31, 36, 48)",
        background: "rgb(246, 247, 251)",
        boxSizing: "border-box",
        sizedWidth: 200,
        bodyMargin: "0px",
      });
    });

    test(`${name}: a dark frame puts the dark colors on the body`, async () => {
      const dark = await computed(adapter, tree, true);
      expect(dark?.color).toBe("rgb(245, 245, 245)");
      expect(dark?.background).toBe("rgb(11, 11, 15)");
    });
  }
});
