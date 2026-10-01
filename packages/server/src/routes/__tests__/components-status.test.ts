import { describe, expect, test } from "bun:test";
import type { FrameworkAdapter } from "@velloo/provider";
import { Hono } from "hono";
import type { DesignFolder } from "../../design-folder.ts";
import { CanvasBundler } from "../../live/canvas-bundler.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { createComponentsRouter } from "../design.ts";

/**
 * The canvas badge's source for a library's own components. Two things it
 * must not do: answer about the default library when the screen renders with
 * another (both can have a `Button`), and drop what a mounted frame found —
 * a component that threw is not "server-rendered" just because the build
 * said so.
 */

function kit(label: string): FrameworkAdapter {
  return {
    id: label.toLowerCase(),
    label,
    loadManifest: async () => [{ id: "Button", source: label.toLowerCase() }],
  } as unknown as FrameworkAdapter;
}

function fixture() {
  const bundler = new CanvasBundler(
    "/tmp/velloo-components-status",
    () => undefined,
    () => undefined,
  );
  const ctx = {
    folder: {
      config: { defaultLibrary: "app", libraries: { app: {}, marketing: {} }, extensions: {} },
    } as unknown as DesignFolder,
    providers: { app: kit("AppKit"), marketing: kit("PromoKit") },
  } as unknown as MutationContext;
  const root = new Hono();
  root.route(
    "/api/components",
    createComponentsRouter(() => ctx, bundler),
  );
  return { root, bundler };
}

type Answer = {
  diagnostics: { id: string; status: string; note?: string; code?: string; observed?: boolean }[];
};

async function ask(root: Hono, query: string): Promise<Answer> {
  const res = await root.request(`/api/components/status?${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Answer;
}

describe("/api/components/status", () => {
  test("answers about the library it is asked about, defaulting to the folder's", async () => {
    const { root } = fixture();
    const promo = await ask(root, "ids=Button&library=marketing");
    expect(promo.diagnostics[0]?.note).toContain("PromoKit");
    const fallback = await ask(root, "ids=Button");
    expect(fallback.diagnostics[0]?.note).toContain("AppKit");
  });

  test("an unknown library is refused rather than answered as the default", async () => {
    const { root } = fixture();
    const res = await root.request("/api/components/status?ids=Button&library=nope");
    expect(res.status).toBe(400);
  });

  test("a frame's runtime verdict wins over the build's, for its own library only", async () => {
    const { root, bundler } = fixture();
    bundler.recordRuntime("/api/canvas/bundle.js?v=1&lib=marketing&refs=Button", [
      { id: "Button", status: "fallback", code: "render-threw", note: "It threw." },
    ]);

    const promo = await ask(root, "ids=Button&library=marketing");
    expect(promo.diagnostics[0]).toMatchObject({
      status: "fallback",
      code: "render-threw",
      observed: true,
    });

    const app = await ask(root, "ids=Button&library=app");
    expect(app.diagnostics[0]).toMatchObject({ status: "server-rendered", observed: false });
  });
});
