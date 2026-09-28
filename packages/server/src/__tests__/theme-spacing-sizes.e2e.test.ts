import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { measureRendered } from "@velloo/renderer";
import type { Viewport } from "@velloo/schema";
import { createApp } from "../app.ts";
import { extraThemeBlock } from "../index.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import { measuredAt } from "../mcp/tools/computed.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";
import { testContext } from "../testing/design-folder.ts";

/**
 * The route placeholder `velloo init` scaffolds, rendered under a DESIGN.md's
 * t-shirt spacing, keeps a readable paragraph.
 *
 * `theme-spacing-sizes.test.ts` checks the compiled CSS; this checks what a
 * user actually saw — the lead paragraph laid out one word per line because
 * `max-w-xl` resolved to the design system's `xl: 1.5rem`.
 *
 * Opt-in (needs `velloo browser install`): `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";
const viewport: Viewport = { w: 1024, h: 720 };

const LEAD =
  "This is a placeholder, generated from your app's route structure. Rebuild this screen in place.";

let harness: Awaited<ReturnType<typeof testContext>>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  harness = await testContext({
    label: "spacing-sizes-render",
    theme: {
      spacing: { xs: "0.25rem", sm: "0.5rem", md: "0.75rem", lg: "1rem", xl: "1.5rem" },
    },
    screens: {
      index: {
        id: "index",
        name: "Home",
        // The placeholder's shape, from cli scan/generate-screens.ts.
        tree: {
          $ref: "Box",
          props: { className: "flex flex-col items-center gap-6 px-6 py-16 text-center" },
          children: [
            { $ref: "Heading", props: { level: 1, children: "Home" } },
            { $ref: "Text", props: { variant: "lead", className: "max-w-xl", children: LEAD } },
          ],
        },
      },
    },
  });
  const { folder, ctx } = harness;
  app = createApp(
    () => ctx,
    new TailwindJit(ctx.defaultProvider, join(folder.root, "screens"), undefined, () =>
      extraThemeBlock(folder),
    ),
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

describe.skipIf(!RUN)("a scaffolded placeholder under t-shirt spacing (Playwright)", () => {
  test("the lead paragraph is laid out at its container width, not one word per line", async () => {
    const res = await app.fetch(
      new Request(
        `http://localhost/api/render/index?w=${viewport.w}&h=${viewport.h}&mode=light&canvas=1&v=1.0`,
        { headers: { origin: "http://localhost" } },
      ),
    );
    expect(res.status).toBe(200);
    const lead = measuredAt(await measureRendered({ html: await res.text(), viewport }), [1]);
    expect(lead).not.toBeNull();
    // max-w-xl is 36rem (576px); under the bug it was 1.5rem (24px).
    expect(lead?.rect.w ?? 0).toBeGreaterThan(400);
    expect(lead?.rect.h ?? Number.POSITIVE_INFINITY).toBeLessThan(120);
  }, 90_000);
});
