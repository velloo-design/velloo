import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Screen } from "@velloo/schema";
import { createServer, type ServerHandle } from "../index.ts";
import { fixtureApp } from "../repo/__tests__/fixture-app.ts";
import { designConfig, scaffoldDesignFolder } from "../testing/design-folder.ts";

/**
 * `compare_to_url` as an agent calls it, against a page whose differences from
 * the design are known in advance. The diff's parts are tested on their own
 * (`style-diff`, `text-diff`); this is the tool's answer — that a node's
 * mismatch arrives with the classes to edit and the one call that fixes it,
 * and that making that call is what closes the gap.
 *
 * Opt-in (needs `velloo browser install`): `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";

const screen: Screen = {
  id: "card",
  name: "Card",
  tree: {
    $ref: "Box",
    props: { className: "w-full p-8 bg-background" },
    children: [
      {
        $id: "panel",
        $ref: "Box",
        props: { className: "w-full h-40 p-4 bg-primary text-primary-foreground" },
        children: [
          {
            $id: "hours",
            $ref: "Box",
            props: { as: "p", className: "text-base", children: "Open 9am to 6pm" },
          },
        ],
      },
    ],
  },
};

/** The same page with a taller, roomier, black panel — and a different closing hour. */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} html,body{margin:0;padding:0;background:#fff;font-family:sans-serif}
  .shell{width:100%;padding:32px}
  .panel{width:100%;height:240px;padding:40px;background:#000;color:#fff}
  p{margin:0;font-size:16px}
</style></head><body><div class="shell"><div class="panel"><p>Open 9am to 5pm</p></div></div></body></html>`;

describe.skipIf(!RUN)("compare_to_url over MCP (Playwright)", () => {
  let app: Awaited<ReturnType<typeof fixtureApp>>;
  let folder: Awaited<ReturnType<typeof scaffoldDesignFolder>>;
  let server: ServerHandle;
  let page: ReturnType<typeof Bun.serve>;
  let client: Client;

  beforeAll(async () => {
    app = await fixtureApp();
    folder = await scaffoldDesignFolder({
      label: "compare-tool",
      config: designConfig({ hostApp: { root: app.root } }),
      screens: { card: screen },
    });
    server = await createServer({
      folder: folder.root,
      port: 0,
      mcp: { transport: "http", port: 0 },
    });
    page = Bun.serve({
      port: 0,
      fetch: () => new Response(PAGE, { headers: { "Content-Type": "text/html" } }),
    });
    client = new Client({ name: "compare-e2e", version: "0.0.0" });
    const url = new URL(server.mcpUrl ?? "");
    url.searchParams.set("surface", "full");
    await client.connect(
      new StreamableHTTPClientTransport(url) as Parameters<typeof client.connect>[0],
    );
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    page?.stop(true);
    await server?.close();
    await folder?.cleanup();
    await app?.cleanup();
  });

  interface Comparison {
    similarity: number;
    styleDiff?: {
      node: string;
      path: number[];
      classes?: string;
      differs: { property: string; design: string; page: string }[];
    }[];
    fixInPlace?: string;
    textDiff?: { changed?: { page: string; design: string; node: string }[] };
  }

  const compare = async (): Promise<Comparison> => {
    const result = await client.callTool({
      name: "compare_to_url",
      arguments: {
        screenId: "card",
        source: { url: `http://127.0.0.1:${page.port}/` },
        viewport: { w: 800, h: 600 },
        image: false,
      },
    });
    if (result.isError) throw new Error(JSON.stringify(result.content));
    return result.structuredContent as unknown as Comparison;
  };

  test("a mismatched node comes with its classes and the call that fixes it, and that call closes the gap", async () => {
    const before = await compare();
    const panel = before.styleDiff?.find((entry) => entry.node === "Box#panel @[0]");
    if (!panel) throw new Error(`no style diff for the panel: ${JSON.stringify(before)}`);
    expect(panel.path).toEqual([0]);
    // The node's own classes, so the fix needs no get_screen first — and ahead
    // of the property list they are read against.
    expect(panel.classes).toBe("w-full h-40 p-4 bg-primary text-primary-foreground");
    expect(Object.keys(panel).indexOf("classes")).toBeLessThan(
      Object.keys(panel).indexOf("differs"),
    );
    expect(panel.differs).toContainEqual({ property: "padding", design: "16px", page: "40px" });
    expect(panel.differs).toContainEqual({ property: "height", design: "160px", page: "240px" });
    expect(before.fixInPlace).toContain("update_props { screenId, patches: [{ path, style }] }");
    // The words are compared too, and the line that differs is named by its node.
    expect(before.textDiff).toEqual({
      changed: [{ page: "Open 9am to 5pm", design: "Open 9am to 6pm", node: "Box#hours @[0,0]" }],
    });

    // Exactly the call the result describes: the path and classes it gave, edited.
    const fixed = await client.callTool({
      name: "update_props",
      arguments: {
        screenId: "card",
        patches: [
          {
            path: panel.path,
            style: (panel.classes ?? "")
              .replace("h-40", "h-60")
              .replace("p-4", "p-10")
              .replace("bg-primary text-primary-foreground", "bg-foreground text-background"),
          },
          { path: "@hours", propPatch: { children: "Open 9am to 5pm" } },
        ],
      },
    });
    if (fixed.isError) throw new Error(JSON.stringify(fixed.content));

    const after = await compare();
    expect(after.similarity).toBeGreaterThan(before.similarity + 0.2);
    const stillOff = after.styleDiff?.find((entry) => entry.node === "Box#panel @[0]")?.differs;
    expect((stillOff ?? []).map((entry) => entry.property)).not.toContain("padding");
    expect((stillOff ?? []).map((entry) => entry.property)).not.toContain("height");
    expect(after.textDiff).toBeUndefined();
  }, 180_000);
});
