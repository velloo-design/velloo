import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createProvider as createNoneProvider } from "@velloo/provider-none";
import { createApp } from "../../app.ts";
import { CanvasBundler } from "../../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../../live/component-bundler.ts";
import { TailwindJit } from "../../styles/tailwind-jit.ts";
import { designConfig, type TestContext, testContext } from "../../testing/design-folder.ts";
import { createRepoComponents } from "../store.ts";
import { fixtureApp } from "./fixture-app.ts";

/**
 * `/api/render/repo/:componentId` is what the Library's detail view draws for
 * every repository component, so a document it cannot build blanks the whole
 * Repo shelf at once.
 */
let app: Awaited<ReturnType<typeof fixtureApp>>;
let t: TestContext;
let server: ReturnType<typeof createApp>;

beforeAll(async () => {
  app = await fixtureApp();
  t = await testContext({
    provider: createNoneProvider(),
    config: designConfig({
      library: { id: "none", version: "t", source: "binary", componentsPath: "binary" },
      styling: { framework: "none" },
      hostApp: { root: app.root },
    }),
    screens: { home: { id: "home", name: "Home", tree: { $ref: "Box", children: [] } } },
  });
  t.ctx.repo = createRepoComponents(t.folder, t.ctx.providers);
  const { folder, ctx } = t;
  server = createApp(
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
      false,
      { repo: ctx.repo },
    ),
  );
});
afterAll(async () => {
  await t.cleanup();
  await app.cleanup();
});

describe("/api/render/repo/:componentId", () => {
  test("renders a catalog component whose key is not a valid screen id", async () => {
    const res = await server.fetch(
      new Request("http://localhost/api/render/repo/StatCard?w=480&h=200&canvas=1", {
        headers: { origin: "http://localhost" },
      }),
    );
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain("didn't render");
  });

  test("an unknown component is a 404, not an error page", async () => {
    const res = await server.fetch(
      new Request("http://localhost/api/render/repo/Nope", {
        headers: { origin: "http://localhost" },
      }),
    );
    expect(res.status).toBe(404);
  });
});
