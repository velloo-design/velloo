import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Screen, Theme, Viewport } from "@velloo/schema";
import { registry } from "@velloo/shadcn-snapshot";
import { type Browser, chromium, type Page } from "playwright-core";
import { createElement, type ReactNode } from "react";
import { renderScreen } from "../index.ts";

/**
 * Text beside elements, on the canvas, in a real browser.
 *
 * `<li>Remote <a>Apply</a> today</li>` holds two runs of text that are no
 * element's whole content. They render as bare text nodes — a wrapper of
 * Velloo's own is what an app's `.jobs li span` used to restyle — which leaves
 * them with no element to carry a path. These are the things that have to keep
 * working anyway: a click and a hover resolve to the run's own path, its box
 * can be measured, and it can be shown as selected.
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
const viewport: Viewport = { w: 600, h: 400 };

const screen: Screen = {
  id: "s",
  name: "S",
  tree: {
    $ref: "Box",
    props: { as: "ul", className: "jobs", style: { padding: "40px", fontSize: "20px" } },
    children: [
      {
        $ref: "Box",
        props: { as: "li", style: { padding: "30px" } },
        children: [
          { $text: "Remote " },
          { $ref: "Box", props: { as: "a", href: "#", children: "Apply" } },
          { $text: " today" },
        ],
      },
      // A component that writes text of its own beside its children: which DOM
      // text node is the design's can't be told, so its text selects as it.
      {
        $ref: "Starred",
        children: [{ $text: "Rated " }, { $ref: "Box", props: { as: "b", children: "five" } }],
      },
    ],
  },
};

function Starred({ children, ...rest }: { children?: ReactNode }) {
  return createElement("p", { ...rest, id: "starred" }, "★ ", children);
}

/** The app's rule the old wrapper span collided with. */
const APP_CSS = ".jobs li span { color: rgb(255, 0, 0); font-weight: 900; }";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

describe.skipIf(!RUN)("text nodes on the canvas (Playwright)", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const { html } = await renderScreen(screen, theme, {
      viewport,
      snapshotCss: "",
      registry: { ...registry, Starred },
      customCss: APP_CSS,
    });
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: viewport.w, height: viewport.h } });
    await page.setContent(html, { waitUntil: "load" });
    // Open the channel the canvas opens, and keep what the runtime sends.
    await page.evaluate(() => {
      const channel = new MessageChannel();
      const w = window as Window & { __sent?: unknown[]; __port?: MessagePort };
      w.__sent = [];
      w.__port = channel.port1;
      channel.port1.onmessage = (ev) => w.__sent?.push(ev.data);
      window.postMessage({ type: "__velloo_init" }, "*", [channel.port2]);
    });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  /** The box of the nth text node directly inside `selector`. */
  const textBox = (selector: string, nth: number): Promise<Rect> =>
    page.evaluate(
      ([sel, index]) => {
        const texts = [...(document.querySelector(sel as string)?.childNodes ?? [])].filter(
          (node) => node.nodeType === 3,
        );
        const range = document.createRange();
        range.selectNodeContents(texts[index as number] as Node);
        const r = range.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      },
      [selector, nth] as [string, number],
    );

  const sent = (type: string) =>
    page.evaluate(
      (wanted) =>
        ((window as Window & { __sent?: { type: string }[] }).__sent ?? []).filter(
          (message) => message.type === wanted,
        ),
      type,
    ) as Promise<{ type: string; path?: string | null; rects?: (Rect & { path: string })[] }[]>;

  const post = (message: Record<string, unknown>) =>
    page.evaluate((m) => {
      (window as Window & { __port?: MessagePort }).__port?.postMessage(m);
    }, message);

  test("the text is bare: no wrapper, so the app's span rule has nothing to match", async () => {
    const li = await page.evaluate(() => {
      const el = document.querySelector("li") as HTMLElement;
      return {
        kinds: [...el.childNodes].map((node) => (node.nodeType === 3 ? "text" : node.nodeName)),
        text: el.textContent,
        spans: el.querySelectorAll("span").length,
        marked: el.getAttribute("data-node-text"),
        color: getComputedStyle(el).color,
      };
    });
    expect(li.kinds).toEqual(["text", "A", "text"]);
    expect(li.text).toBe("Remote Apply today");
    expect(li.spans).toBe(0);
    expect(li.marked).toBe("0,2");
    expect(li.color).not.toBe("rgb(255, 0, 0)");
  });

  test("a click on a run selects that run; beside it, the element it sits in", async () => {
    const first = await textBox("li", 0);
    await page.mouse.click(first.x + first.w / 2, first.y + first.h / 2);
    const last = await textBox("li", 1);
    await page.mouse.click(last.x + last.w / 2, last.y + last.h / 2);
    // The link between them is its own element, as it always was.
    const link = await page.locator("li a").boundingBox();
    if (!link) throw new Error("no link box");
    await page.mouse.click(link.x + link.width / 2, link.y + link.height / 2);
    // The li's padding belongs to the li.
    const li = await page.locator("li").boundingBox();
    if (!li) throw new Error("no li box");
    await page.mouse.click(li.x + 5, li.y + 5);
    await page.waitForTimeout(50);

    const selected = (await sent("select")).map((message) => message.path);
    expect(selected).toEqual(["0.0", "0.2", "0.1", "0"]);
  });

  test("text in a component that writes its own beside it selects the component", async () => {
    // Two text nodes in the DOM, one in the design: guessing which is which
    // would select the wrong thing half the time.
    const design = await textBox("#starred", 1);
    await page.mouse.click(design.x + design.w / 2, design.y + design.h / 2);
    await page.waitForTimeout(50);
    expect((await sent("select")).at(-1)?.path).toBe("1");
  });

  test("hovering reports the run, and moving off it within the same element reports that", async () => {
    const first = await textBox("li", 0);
    const li = await page.locator("li").boundingBox();
    if (!li) throw new Error("no li box");
    await page.mouse.move(first.x + first.w / 2, first.y + first.h / 2);
    await page.waitForTimeout(50);
    // Still inside the li: no mouseover fires, only a move.
    await page.mouse.move(li.x + 5, li.y + 5);
    await page.waitForTimeout(50);
    const hovered = (await sent("hover")).map((message) => message.path);
    expect(hovered.slice(-2)).toEqual(["0.0", "0"]);
  });

  test("a run's rect is the box of its glyphs, not of its parent", async () => {
    const box = await textBox("li", 1);
    await post({ type: "requestRects", paths: ["0.2", "0"] });
    await page.waitForTimeout(50);
    const rects = (await sent("nodeRects")).at(-1)?.rects ?? [];
    const run = rects.find((rect) => rect.path === "0.2");
    const parent = rects.find((rect) => rect.path === "0");
    expect(run?.w).toBeCloseTo(box.w, 0);
    expect(run?.x).toBeCloseTo(box.x, 0);
    expect(run?.h).toBeGreaterThan(0);
    expect(parent?.w).toBeGreaterThan((run?.w ?? 0) * 2);
  });

  test("a selected run is tinted through the highlight registry, with nothing added to the DOM", async () => {
    const before = await page.evaluate(() => document.querySelector("li")?.innerHTML);
    await post({ type: "applyHighlight", path: "0.0" });
    await page.waitForTimeout(50);
    const state = await page.evaluate(() => ({
      held: CSS.highlights.has("velloo-selected"),
      text: [...(CSS.highlights.get("velloo-selected") ?? [])].map((range) =>
        (range as Range).toString(),
      ),
      html: document.querySelector("li")?.innerHTML,
    }));
    expect(state.held).toBe(true);
    expect(state.text).toEqual(["Remote "]);
    expect(state.html).toBe(before);

    await post({ type: "clearHighlight" });
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => CSS.highlights.has("velloo-selected"))).toBe(false);
  });
});
