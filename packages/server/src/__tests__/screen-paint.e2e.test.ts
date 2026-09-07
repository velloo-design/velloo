import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { diffPngs, screenshotBuffer } from "@velloo/renderer";
import type { Viewport } from "@velloo/schema";
import { createApp } from "../app.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";
import { testContext } from "../testing/design-folder.ts";

/**
 * The canvas actually paints what `/api/render/:screenId` returns.
 *
 * Markup and a stylesheet coming back is not the same as pixels landing: a
 * theme that never reaches the document, or utilities that compile to nothing,
 * both produce a well-formed page that renders as a blank white rectangle —
 * which is precisely what a designer reports as "all my screens are white
 * boxes". So this renders through the real Tailwind compile, screenshots it in
 * a real browser, and compares against an empty page of the same size.
 *
 * Opt-in (needs `velloo browser install`): `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";
const viewport: Viewport = { w: 800, h: 600 };

/**
 * A theme no browser would land on by accident. The white-box failure is the
 * theme never reaching the document, so the fixture makes "themed" and
 * "unstyled" different colours rather than two shades of white.
 */
const theme = {
  colors: {
    background: "oklch(0.28 0.07 265)",
    foreground: "oklch(0.97 0.01 265)",
    primary: { DEFAULT: "oklch(0.72 0.19 45)", foreground: "oklch(0.2 0.03 45)" },
  },
};

/** Full-bleed, like a real screen: the background is most of what a frame shows,
 *  and is the first thing to go white. */
const screens = {
  filled: {
    id: "filled",
    name: "Filled",
    tree: {
      $ref: "Card",
      props: {
        className: "min-h-screen w-full rounded-none flex flex-col gap-4 bg-background p-8",
      },
      children: [
        { $ref: "Heading", props: { level: 1, children: "Quarterly report" } },
        { $ref: "Text", props: { children: "Revenue is up across every region." } },
        { $ref: "Badge", props: { variant: "secondary", children: "Beta" } },
        { $ref: "Button", props: { children: "Export CSV" } },
      ],
    },
  },
  sparse: {
    id: "sparse",
    name: "Sparse",
    tree: {
      $ref: "Card",
      props: { className: "min-h-screen w-full rounded-none bg-background" },
      children: [],
    },
  },
};

let harness: Awaited<ReturnType<typeof testContext>>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  harness = await testContext({ label: "screen-paint", screens, theme });
  const { folder, ctx } = harness;
  app = createApp(
    () => ctx,
    new TailwindJit(ctx.defaultProvider, join(folder.root, "screens")),
    new LiveBundler(
      folder.root,
      () => folder.config,
      () => liveExtensions(folder.config.extensions),
    ),
    new CanvasBundler(
      folder.root,
      () => folder.config.hostApp,
      () => undefined,
    ),
  );
});

afterAll(() => harness?.cleanup());

async function shoot(screenId: string): Promise<Buffer> {
  const res = await app.fetch(
    new Request(
      `http://localhost/api/render/${screenId}?w=${viewport.w}&h=${viewport.h}&mode=light&canvas=1&v=1.0`,
      { headers: { origin: "http://localhost" } },
    ),
  );
  if (res.status !== 200) throw new Error(`render ${screenId} returned ${res.status}`);
  return screenshotBuffer({ html: await res.text(), viewport, fullPage: false });
}

const BLANK = "<!doctype html><html><head></head><body></body></html>";

describe.skipIf(!RUN)("a rendered screen paints (Playwright)", () => {
  test("differs from an empty page — it is not a white box", async () => {
    const blank = await screenshotBuffer({ html: BLANK, viewport, fullPage: false });
    const painted = await shoot("filled");
    const { changedRatio } = diffPngs(blank, painted);
    // The themed background alone covers the frame, so a working render differs
    // almost everywhere. An unstyled one scores ~0.
    expect(changedRatio).toBeGreaterThan(0.9);
  }, 90_000);

  test("paints each screen as itself, not one shared frame", async () => {
    // Guards the failure where every frame renders the same thing (a shared
    // error page, say) — which still beats the blank comparison above. Both
    // screens share the background, so only the content differs.
    const { changedRatio } = diffPngs(await shoot("filled"), await shoot("sparse"));
    expect(changedRatio).toBeGreaterThan(0.02);
  }, 90_000);

  test("renders deterministically, so a visual diff means a real change", async () => {
    const { changedPixels } = diffPngs(await shoot("filled"), await shoot("filled"));
    expect(changedPixels).toBe(0);
  }, 90_000);
});
