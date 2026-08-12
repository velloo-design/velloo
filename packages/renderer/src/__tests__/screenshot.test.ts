import { describe, expect, test } from "bun:test";
import { rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme, Variant } from "@velloo/schema";
import { renderVariant, screenshot } from "../index.ts";

// Opt-in: requires `bunx playwright install chromium`.
const RUN = process.env.VELLOO_E2E === "1";

describe.skipIf(!RUN)("screenshot (Playwright)", () => {
  test("writes a non-empty PNG", async () => {
    const variant: Variant = {
      id: "desktop",
      name: "Desktop",
      viewport: { w: 800, h: 400 },
      tree: {
        $ref: "Card",
        props: { className: "p-6 flex flex-col gap-4 m-12" },
        children: [
          { $ref: "Heading", props: { level: 1, children: "Welcome" } },
          { $ref: "Button", props: { children: "Continue" } },
        ],
      },
    };
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

    const out = join(tmpdir(), `velloo-shot-${Date.now()}.png`);
    try {
      // Empty snapshotCss — Tailwind classes won't style anything, but the
      // smoke test only checks that Playwright produced a non-trivial PNG.
      const { html } = await renderVariant(variant, theme, { snapshotCss: "" });
      await screenshot({ html, viewport: variant.viewport, outPath: out });
      const s = await stat(out);
      expect(s.size).toBeGreaterThan(1000);
    } finally {
      await rm(out, { force: true });
    }
  }, 60_000);
});
