import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { serveFolderAsset } from "../../index.ts";
import { type TestContext, testContext } from "../../testing/design-folder.ts";
import { registerAssetTools } from "../tools/assets.ts";

type Handler = (args: Record<string, unknown>) => Promise<{
  isError?: true;
  content: { type: "text"; text: string }[];
}>;

const PNG = Buffer.from("89504e470d0a1a0a", "hex");

let design: TestContext;
let app: string;
let tools: Map<string, Handler>;

const call = async (name: string, args: Record<string, unknown>) => {
  const handler = tools.get(name);
  if (!handler) throw new Error(`${name} was not registered`);
  return JSON.parse((await handler(args)).content[0]?.text ?? "null");
};

beforeEach(async () => {
  design = await testContext({ screens: { home: true } });
  // An app whose two logos differ only by directory, as `public/` trees do.
  app = await mkdtemp(join(tmpdir(), "velloo-import-assets-"));
  for (const file of ["partners/logo.png", "customers/logo.png", "hero@2x.png"]) {
    await mkdir(join(app, "public/assets", file, ".."), { recursive: true });
    await writeFile(join(app, "public/assets", file), PNG);
  }
  tools = new Map();
  const mcp = {
    registerTool: (name: string, _config: unknown, cb: Handler) => tools.set(name, cb),
  } as unknown as McpServer;
  registerAssetTools(mcp, design.ctx);
});

afterEach(async () => {
  await design.cleanup();
  await rm(app, { recursive: true, force: true });
});

describe("import_assets", () => {
  test("`root` keeps directories and names, so the app's own URLs resolve", async () => {
    const result = await call("import_assets", {
      paths: ["public/assets/**/*.png"],
      baseDir: app,
      root: "public/assets",
    });
    expect(result.imported).toBe(3);
    const urls = result.results.map((entry: { url: string }) => entry.url).sort();
    expect(urls).toEqual([
      "/assets/customers/logo.png",
      "/assets/hero@2x.png",
      "/assets/partners/logo.png",
    ]);
    // The canvas answers the path an app component hard-codes.
    const served = await serveFolderAsset(
      new Request("http://localhost/assets/partners/logo.png"),
      design.root,
    );
    expect(served?.status).toBe(200);

    const listed = await call("list_assets", {});
    expect(listed.assets.map((asset: { url: string }) => asset.url)).toEqual(urls);
  });

  test("without `root`, a same-named file is reported instead of overwriting the first", async () => {
    const result = await call("import_assets", {
      paths: ["public/assets/partners/logo.png", "public/assets/customers/logo.png"],
      baseDir: app,
    });
    expect(result.imported).toBe(1);
    expect(result.results[0].url).toBe("/assets/logo.png");
    expect(result.results[1].error).toContain("same name as");
    expect(result.results[1].error).toContain("root");
  });

  test("`root` refuses what it can't keep exactly: a file outside it, the reserved host branch", async () => {
    await mkdir(join(app, "public/assets/host"), { recursive: true });
    await writeFile(join(app, "public/assets/host/site.png"), PNG);
    await writeFile(join(app, "outside.png"), PNG);
    const result = await call("import_assets", {
      paths: ["outside.png", "public/assets/host/site.png"],
      baseDir: app,
      root: "public/assets",
    });
    expect(result.imported).toBe(0);
    expect(result.results[0].error).toContain("outside `root`");
    expect(result.results[1].error).toContain("reserved");
  });
});
