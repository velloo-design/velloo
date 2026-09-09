import { describe, expect, test } from "bun:test";
import type { FrameworkAdapter } from "@velloo/provider";
import { renderScreen } from "@velloo/renderer";
import { buildDefaultTheme } from "../default-theme.ts";
import { buildElsewhereScaffold } from "../elsewhere-sample.ts";

describe("Elsewhere native compositions", () => {
  for (const library of ["mui", "antd", "chakra", "none"] as const) {
    test(`${library} renders all screens in light and dark mode`, async () => {
      const { createProvider } = await import(`../../../../provider-${library}/src/index.ts`);
      const provider: FrameworkAdapter = createProvider();
      const theme = buildDefaultTheme();
      const sample = buildElsewhereScaffold(library, theme);
      const snippets = new Map(sample.snippets.map((s) => [s.id, s]));
      for (const dark of [false, true]) {
        for (const screen of sample.screens) {
          const rendered = await renderScreen(screen, theme, {
            viewport: { w: dark ? 390 : 1440, h: 1000 },
            dark,
            registry: provider.registryForChannel?.("style") ?? provider.registry,
            snapshotCss: "",
            customCss: sample.customCss,
            snippets,
            renderPass: provider.renderPass?.(theme, dark),
          });
          expect(rendered.failures).toEqual([]);
          expect(rendered.bodyHtml.length).toBeGreaterThan(100);
          expect(rendered.html).not.toContain("NaN");
        }
      }
    });
  }
});
