import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { measureRendered } from "@velloo/renderer";
import type { Viewport } from "@velloo/schema";
import { createApp } from "../app.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import { childrenMeasuredAt, measuredAt } from "../mcp/tools/computed.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";
import { testContext } from "../testing/design-folder.ts";

/**
 * Computed styles are attributed to the design node that produced them.
 *
 * The whole point of measuring in a browser is that the answer can't be
 * derived from the JSON: whether a utility class actually won the cascade,
 * whether a box got a height. That only pays off if the measurement lands on a
 * node the agent can address — which depends on `data-node-path` surviving
 * from `buildTree` through the component into the DOM. Nothing but a real
 * render can check that, so this does.
 *
 * Opt-in (needs `velloo browser install`): `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";
const viewport: Viewport = { w: 800, h: 600 };

const screens = {
  measured: {
    id: "measured",
    name: "Measured",
    tree: {
      $ref: "Box",
      props: { className: "flex flex-col gap-4 p-8" },
      children: [
        { $ref: "Heading", props: { level: 1, children: "Quarterly report" } },
        // Two boxes whose declared widths differ, so a measurement that
        // silently landed on the wrong node would read identically.
        { $ref: "Box", props: { className: "w-64 h-10 bg-primary" }, children: [] },
        { $ref: "Box", props: { className: "w-32 h-20 bg-secondary" }, children: [] },
      ],
    },
  },
};

let harness: Awaited<ReturnType<typeof testContext>>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  harness = await testContext({ label: "measure-rendered", screens });
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

async function measure() {
  const res = await app.fetch(
    new Request(
      `http://localhost/api/render/measured?w=${viewport.w}&h=${viewport.h}&mode=light&canvas=1&v=1.0`,
      { headers: { origin: "http://localhost" } },
    ),
  );
  if (res.status !== 200) throw new Error(`render returned ${res.status}`);
  return measureRendered({ html: await res.text(), viewport });
}

describe.skipIf(!RUN)("measuring a rendered screen (Playwright)", () => {
  test("each design node reads back its own resolved box", async () => {
    const dom = await measure();

    const first = measuredAt(dom, [1]);
    const second = measuredAt(dom, [2]);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // w-64 = 16rem = 256px, h-10 = 2.5rem = 40px; w-32/h-20 = 128/80.
    expect(first?.rect).toMatchObject({ w: 256, h: 40 });
    expect(second?.rect).toMatchObject({ w: 128, h: 80 });
    // The measurement is what the browser resolved, not what the class said.
    expect(first?.style.backgroundColor).toMatch(/^(rgb|oklch|color)/);
  }, 90_000);

  test("children are the screen's own child nodes, in order", async () => {
    const children = childrenMeasuredAt(await measure(), []);
    expect(children.map((c) => c.path)).toEqual(["0", "1", "2"]);
    expect(children[0]?.tag).toBe("h1");
  }, 90_000);
});
