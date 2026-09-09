import { describe, expect, test } from "bun:test";
import type { Screen, Snippet, Theme, Viewport } from "@velloo/schema";
import { registry } from "@velloo/shadcn-snapshot";
import { chromium } from "playwright-core";
import { renderScreen } from "../index.ts";

/**
 * Selection chrome while a snippet is focused, driven through the real
 * protocol in a real browser.
 *
 * Editing a snippet in place moves the selection into the *definition's*
 * namespace (`data-snippet-path`), which shares its shape with the host tree's
 * node paths but addresses something else entirely. `requestRects` only spoke
 * the node-path half, so a snippet selection measured nothing and the parent
 * drew no resize grips — the ring appeared, the handles never did.
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
const viewport: Viewport = { w: 900, h: 700 };

const card: Snippet = {
  id: "feature-card",
  name: "Feature Card",
  params: [{ name: "title", type: "string" }],
  tree: {
    $ref: "Box",
    props: { className: "p-4 border" },
    children: [{ $ref: "Heading", props: { level: 3, children: { $param: "title" } } }],
  },
};

// Two instances of one definition, so "one rect per instance" is observable.
const screen: Screen = {
  id: "s",
  name: "S",
  tree: {
    $ref: "Box",
    props: { className: "flex flex-col gap-6 p-6" },
    children: [
      { $snippet: "feature-card", args: { title: "First" } },
      { $snippet: "feature-card", args: { title: "Second" } },
    ],
  },
};

interface Reported {
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
  snippet?: boolean;
}

describe.skipIf(!RUN)("snippet-scoped rects (Playwright)", () => {
  async function ask(snippetPaths: string[], focus: string | null): Promise<Reported[]> {
    const { html } = await renderScreen(screen, theme, {
      viewport,
      snapshotCss: "",
      registry,
      snippets: new Map([[card.id, card]]),
    });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      return await page.evaluate(
        async ([paths, snippetId]) => {
          const channel = new MessageChannel();
          const rects = new Promise<Reported[]>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("no nodeRects")), 5000);
            channel.port1.onmessage = (ev) => {
              if (ev.data?.type !== "nodeRects") return;
              clearTimeout(timer);
              resolve(ev.data.rects);
            };
          });
          window.postMessage({ type: "__velloo_init" }, "*", [channel.port2]);
          if (snippetId !== null) {
            channel.port1.postMessage({ type: "applySnippetFocus", snippetId });
          }
          channel.port1.postMessage({ type: "requestRects", paths: [], snippetPaths: paths });
          return await rects;
        },
        [snippetPaths, focus] as [string[], string | null],
      );
    } finally {
      await browser.close();
    }
  }

  test("a definition path answers with one real box per instance", async () => {
    // "0" is the Heading inside the card body — present in both instances.
    const rects = await ask(["0"], "feature-card");
    expect(rects).toHaveLength(2);
    for (const r of rects) {
      expect(r.path).toBe("0");
      expect(r.snippet).toBe(true);
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
    }
    // Two separate instances stacked in a column, so they cannot share a y.
    expect(rects[0]?.y).not.toBe(rects[1]?.y);
  }, 30_000);

  test("the definition root measures the instance, not a zero box", async () => {
    const rects = await ask([""], "feature-card");
    expect(rects).toHaveLength(2);
    for (const r of rects) {
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
    }
  }, 30_000);

  test("no focused snippet ⇒ no snippet rects (the paths address nothing)", async () => {
    expect(await ask(["0"], null)).toEqual([]);
  }, 30_000);
});
