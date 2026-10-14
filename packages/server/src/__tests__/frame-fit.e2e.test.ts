import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Frame } from "@velloo/schema";
import { createServer, type ServerHandle } from "../index.ts";
import { scaffoldDesignFolder } from "../testing/design-folder.ts";

/**
 * Frames that follow their screen, measured for real. `frame-fit.test.ts`
 * holds the rules against a height it is handed; this is where the height
 * comes from — the daemon's own headless render of the screen, with the
 * stylesheet it would be drawn with — and that an edit made by any route is
 * measured, not only the compose that created the frame.
 *
 * Opt-in (needs `velloo browser install`): `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";

describe.skipIf(!RUN)("a frame sized to what its screen renders (Playwright)", () => {
  let folder: Awaited<ReturnType<typeof scaffoldDesignFolder>>;
  let server: ServerHandle;
  let client: Client;

  beforeAll(async () => {
    folder = await scaffoldDesignFolder({ label: "frame-fit" });
    server = await createServer({
      folder: folder.root,
      port: 0,
      mcp: { transport: "http", port: 0 },
    });
    client = new Client({ name: "frame-fit-e2e", version: "0.0.0" });
    const url = new URL(server.mcpUrl ?? "");
    url.searchParams.set("surface", "full");
    // The SDK's own transport type disagrees with `Transport` under
    // exactOptionalPropertyTypes (see mcp-wiring.test.ts).
    await client.connect(
      new StreamableHTTPClientTransport(url) as Parameters<typeof client.connect>[0],
    );
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    await server?.close();
    await folder?.cleanup();
  });

  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
    return JSON.parse((result.content as { text: string }[])[0]?.text ?? "{}") as T;
  };
  const frameOf = async (boardId: string, screenId: string): Promise<Frame | undefined> =>
    (await call<{ frames: Frame[] }>("get_board", { boardId })).frames.find(
      (frame) => frame.screen === screenId,
    );

  test("a page composed onto a new screen gets a frame as tall as it renders", async () => {
    const page = (height: number) =>
      `<main><div vellooId="body" className="h-[${height}px] bg-muted">Long page</div></main>`;
    // An arbitrary height only the compiled stylesheet can give the box: a
    // measurement taken without it would see one line of text.
    const made = await call<{ created: { board: string; frame: string; note: string } }>(
      "compose",
      { screenId: "long-page", mode: "replace", jsx: page(1600) },
    );
    expect(made.created.note).toContain("1440×1600 sized to its content");
    expect(await frameOf(made.created.board, "long-page")).toMatchObject({
      w: 1440,
      h: 1600,
      fit: "content",
    });

    // Rewritten shorter, the frame follows down as well as up — which the
    // canvas could never see from inside a frame that is already taller.
    const rewritten = await call<{ framesFitted?: { frame: string; h: number }[] }>("compose", {
      screenId: "long-page",
      mode: "replace",
      jsx: page(1200),
    });
    expect(rewritten.framesFitted).toEqual([{ frame: made.created.frame, h: 1200 }]);

    // An edit that is not a compose is the same event: measured shortly after.
    await call("update_props", {
      screenId: "long-page",
      patches: [{ path: "@body", style: "h-[2000px] bg-muted" }],
    });
    const deadline = Date.now() + 20_000;
    let frame = await frameOf(made.created.board, "long-page");
    while (frame?.h !== 2000 && Date.now() < deadline) {
      await Bun.sleep(250);
      frame = await frameOf(made.created.board, "long-page");
    }
    expect(frame).toMatchObject({ h: 2000, fit: "content" });
  }, 120_000);
});
