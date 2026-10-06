import { describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Screen, Theme } from "@velloo/schema";
import { registry } from "@velloo/shadcn-snapshot";
import { captureMountedDocument, captureScreenshot, renderScreen } from "../index.ts";

setDefaultTimeout(60_000);

// Opt-in: requires `velloo browser install`.
const RUN = process.env.VELLOO_E2E === "1";

/**
 * A picture of a design has nothing of the editor in it.
 *
 * The canvas draws its own scroll thumb over a frame that scrolls. Every
 * capture is of a document that may carry that runtime, and a grey bar down
 * the right edge of a tall page is a difference `compare_to_url` then reports
 * against a design that has no such bar.
 */
describe.skipIf(!RUN)("captures leave the editor's scroll thumb out (Playwright)", () => {
  const theme: Theme = {
    name: "test",
    colors: {
      background: "oklch(0.99 0 0)",
      foreground: "oklch(0.145 0 0)",
      primary: { DEFAULT: "oklch(0.55 0.2 250)", foreground: "oklch(0.985 0 0)" },
    },
    typography: {},
    spacing: {},
    radius: {},
  };
  // Three viewports tall, so the runtime has something to draw a thumb for.
  const tall: Screen = {
    id: "tall",
    name: "Tall",
    tree: {
      $ref: "Box",
      props: { style: { height: "1200px", background: "#fde68a" } },
      children: [{ $ref: "Heading", props: { level: 1, children: "Tall" } }],
    },
  };
  const small = { w: 600, h: 400 };
  const render = async (includeRuntime: boolean) =>
    (
      await renderScreen(tall, theme, {
        snapshotCss: "",
        viewport: small,
        registry,
        includeRuntime,
      })
    ).html;

  test("a page with the canvas runtime photographs as the page without it", async () => {
    const withRuntime = await render(true);
    expect(withRuntime).toContain("__velloo-scrollthumb");
    const edited = await captureScreenshot({ html: withRuntime, viewport: small });
    const bare = await captureScreenshot({ html: await render(false), viewport: small });
    expect(edited.png.equals(bare.png)).toBe(true);
  });

  test("and freezes without it", async () => {
    const frozen = await captureMountedDocument({ html: await render(true), viewport: small });
    expect(frozen.body).not.toContain("__velloo-scrollthumb");
  });
});
