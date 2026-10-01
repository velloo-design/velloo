import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider as createNoneProvider } from "@velloo/provider-none";
import type { CanvasBundler } from "../../../live/canvas-bundler.ts";
import type { LiveBundler } from "../../../live/component-bundler.ts";
import { fixtureApp } from "../../../repo/__tests__/fixture-app.ts";
import { createRepoComponents } from "../../../repo/store.ts";
import type { TailwindJit } from "../../../styles/tailwind-jit.ts";
import { designConfig, type TestContext, testContext } from "../../../testing/design-folder.ts";
import { registerRepoTools } from "../repo.ts";

/**
 * A component can mount cleanly in an entry that never loads the app's global
 * stylesheet — and then every class the app defines there renders as nothing.
 * preview_status must not call that entry valid.
 */
type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>;

let app: Awaited<ReturnType<typeof fixtureApp>>;
let t: TestContext;
let previewStatus: Handler;
let previewPath: string;

beforeAll(async () => {
  app = await fixtureApp();
  t = await testContext({
    provider: createNoneProvider(),
    config: designConfig({
      library: { id: "none", version: "t", source: "binary", componentsPath: "binary" },
      styling: { framework: "none" },
      hostApp: { root: app.root },
    }),
  });
  previewPath = join(t.folder.root, "preview.jsx");
  t.ctx.repo = createRepoComponents(t.folder, t.ctx.providers);
  const handlers = new Map<string, Handler>();
  const mcp = {
    registerTool: (name: string, _config: unknown, cb: Handler) => handlers.set(name, cb),
  } as unknown as McpServer;
  registerRepoTools(
    mcp,
    t.ctx,
    {} as TailwindJit,
    {} as LiveBundler,
    { invalidate: () => {} } as unknown as CanvasBundler,
  );
  const handler = handlers.get("preview_status");
  if (!handler) throw new Error("preview_status was not registered");
  previewStatus = handler;
});
afterAll(async () => {
  await t.cleanup();
  await app.cleanup();
});

async function status(): Promise<Record<string, unknown>> {
  t.ctx.repo?.invalidate();
  const result = await previewStatus({ probe: false });
  return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("preview_status and the app's global stylesheets", () => {
  test("an entry without the app's stylesheet is incomplete, and says which and how to fix", async () => {
    await writeFile(previewPath, "export default ({ children }) => children;\n");
    const report = await status();
    expect(report.state).toBe("incomplete");
    expect(report.unloadedStylesheets).toEqual([
      { specifier: "./styles.css", at: "src/main.jsx:1" },
    ]);
    expect(String(report.next)).toContain("set_preview_entry");
    expect(String(report.suggestedPreviewEntry)).toContain("styles.css");
  });

  test("an entry that imports it, by its own relative path, is valid", async () => {
    const sheet = relative(t.folder.root, join(app.root, "src/styles.css"));
    await writeFile(
      previewPath,
      `import "${sheet.startsWith(".") ? sheet : `./${sheet}`}";\nexport default ({ children }) => children;\n`,
    );
    const report = await status();
    expect(report.state).toBe("valid");
    expect(report.unloadedStylesheets).toBeUndefined();
  });
});
