import { afterEach, beforeEach, expect, test } from "bun:test";
import type { IntentPrice } from "@velloo/protocol";
import { $, domSuite, mount, settle, text } from "./dom.ts";

/**
 * The image pane offers what the cloud's intent list says, under the cloud's
 * labels and shapes, so a new, renamed or withdrawn intent reaches it without a
 * velloo release.
 */

const { ImagePanel } = await import("../components/ImagePanel.tsx");
const { useCanvas } = await import("../store.ts");

const intent = (over: Partial<IntentPrice> & { intent: string }): IntentPrice => ({
  summary: "",
  priceMicros: 40_000,
  output: "image",
  aspects: ["1:1", "16:9"],
  defaultAspect: "1:1",
  reference: "optional",
  ...over,
});

const realFetch = globalThis.fetch;

domSuite("image pane catalogue", () => {
  beforeEach(() => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/assets/intents")) {
        return Response.json({
          intents: [
            intent({ intent: "vector", label: "Vector art", output: "svg", aspects: ["1:1"] }),
            intent({ intent: "poster", label: "Poster", maxPromptChars: 500 }),
            intent({ intent: "cutout", label: "Cut out", reference: "required" }),
          ],
        });
      }
      if (url.startsWith("/api/assets")) return Response.json({ generated: {} });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const showFor = async (intentId: string) => {
    useCanvas.setState({
      generatedAssets: {
        "assets/hero.png": {
          prompt: "a hero",
          intent: intentId,
          generatedAt: new Date().toISOString(),
        },
      },
    } as never);
    const view = await mount(<ImagePanel screenId="home" path="0" src="/assets/hero.png" />);
    await settle(10);
    return view;
  };

  test("an svg intent shows the cloud's label and no shape picker", async () => {
    const view = await showFor("vector");
    expect(text($("#image-intent"))).toContain("Vector art");
    expect($("#image-aspect")).toBeNull();
    await view.unmount();
  });

  test("an intent this velloo has never heard of is offered with its own limit", async () => {
    const view = await showFor("poster");
    expect(text($("#image-intent"))).toContain("Poster");
    expect($("#image-aspect")).not.toBeNull();
    expect(($("[data-testid=image-panel-prompt]") as HTMLTextAreaElement).maxLength).toBe(500);
    await view.unmount();
  });
});
