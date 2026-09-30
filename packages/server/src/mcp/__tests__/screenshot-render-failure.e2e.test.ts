import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { closePooledBrowser } from "@velloo/renderer";
import { CanvasBundler } from "../../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../../live/component-bundler.ts";
import { TailwindJit } from "../../styles/tailwind-jit.ts";
import { testContext } from "../../testing/design-folder.ts";
import type { DesignDiagnostic } from "../diagnostics.ts";
import { registerScreenshotCaptureTool } from "../tools/screenshot-capture.ts";

/**
 * One node that cannot render must not cost the agent the whole screenshot:
 * the rest of the screen is exactly what it needs to see while it fixes that
 * node. Both fixtures are shapes an agent composed in an eval — each used to
 * fail the call outright, and the agent retried it until it ran out of steps.
 *
 * Opt-in (needs `velloo browser install`): `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";

const screens = {
  broken: {
    id: "broken",
    name: "Broken",
    tree: {
      $ref: "Box",
      props: { className: "flex flex-col gap-4 p-8" },
      children: [
        { $ref: "Heading", props: { level: 1, children: "London is eating" } },
        {
          $ref: "Button",
          props: { asChild: true },
          children: [{ $ref: "Box", props: { as: "a", href: "#guide", children: "Explore" } }],
        },
        { $ref: "Box", props: { as: "input", children: "Search dishes" } },
      ],
    },
  },
};

type ToolResult = {
  isError?: boolean;
  content: ({ type: "text"; text: string } | { type: "image"; data: string })[];
};
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

let harness: Awaited<ReturnType<typeof testContext>>;
let screenshot: ToolHandler;

beforeAll(async () => {
  harness = await testContext({ label: "screenshot-render-failure", screens });
  const { folder, ctx } = harness;
  let handler: ToolHandler | undefined;
  const mcp = {
    registerTool: (name: string, _config: unknown, cb: ToolHandler) => {
      if (name === "screenshot") handler = cb;
    },
  } as unknown as McpServer;
  registerScreenshotCaptureTool(
    mcp,
    ctx,
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
  if (!handler) throw new Error("screenshot was not registered");
  screenshot = handler;
});

afterAll(async () => {
  await closePooledBrowser();
  await harness?.cleanup();
});

describe.skipIf(!RUN)("screenshot with a node that cannot render (Playwright)", () => {
  test("returns the image, with the failure named at its path", async () => {
    const result = await screenshot({ screenId: "broken", viewport: { w: 800, h: 600 } });

    expect(result.isError).toBeUndefined();
    expect(result.content.some((part) => part.type === "image")).toBe(true);
    const text = result.content.find((part) => part.type === "text");
    const summary = JSON.parse(text?.type === "text" ? text.text : "{}") as {
      diagnostics?: DesignDiagnostic[];
    };
    const threw = summary.diagnostics?.filter((d) => d.code === "render/component-threw");
    // The `asChild` button renders; only the `<input>` with children is broken.
    expect(threw).toEqual([
      {
        severity: "error",
        code: "render/component-threw",
        path: [2],
        message: expect.stringContaining("input is a self-closing tag"),
      },
    ]);
  }, 90_000);
});
