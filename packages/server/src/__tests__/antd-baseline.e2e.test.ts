import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createProvider } from "@velloo/provider-antd";
import { renderScreen } from "@velloo/renderer";
import type { Screen, Theme } from "@velloo/schema";
import { type Browser, chromium } from "playwright-core";

/**
 * antd ships no global reset and its cssinjs rules are scoped to its own
 * component classes, so a plain element in an antd frame used to fall through
 * to the browser default (Times, 16px, black). This loads a real antd SSR in
 * chromium and reads what a plain element actually computes. Opt-in:
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
  typography: {
    fontFamily: { sans: "Inter, sans-serif" },
    typesets: { default: { size: 14, leading: 1.5 } },
  },
  spacing: { 1: 4 },
  radius: { md: 8 },
};

const screen: Screen = {
  id: "s",
  name: "S",
  tree: {
    $ref: "Flex",
    props: { vertical: true, gap: 8 },
    children: [
      { $ref: "Box", props: { id: "plain", children: "loose text" } },
      { $ref: "Button", props: { type: "primary", children: "Go" } },
    ],
  },
};

describe.skipIf(!RUN)("antd document baseline (Playwright)", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(() => browser?.close());

  test("a plain element inherits the theme's font, size and color", async () => {
    const antd = createProvider();
    const { html } = await renderScreen(screen, theme, {
      viewport: { w: 400, h: 300 },
      snapshotCss: "",
      registry: antd.registry,
      renderPass: antd.renderPass?.(theme),
      includeRuntime: false,
    });
    const page = await browser.newPage();
    await page.setContent(html);
    const plain = await page.evaluate(() => {
      const el = document.getElementById("plain");
      if (!el) return null;
      const s = getComputedStyle(el);
      return { fontFamily: s.fontFamily, fontSize: s.fontSize, color: s.color };
    });
    expect(plain).toEqual({
      fontFamily: "Inter, sans-serif",
      fontSize: "14px",
      color: "rgb(31, 36, 48)",
    });
  });
});
