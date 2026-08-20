import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import createEmotionServer from "@emotion/server/create-instance";
import { ThemeProvider } from "@mui/material/styles";
import type { RenderPass } from "@velloo/provider";
import type { Theme as VellooTheme } from "@velloo/schema";
import { createElement } from "react";
import { muiThemeFrom } from "./theme.ts";

/**
 * A fresh emotion + MUI render pass for one SSR. `wrap` nests the tree under a
 * per-render emotion CacheProvider + a MUI ThemeProvider built from velloo's
 * tokens; `css(html)` extracts exactly the emotion rules the rendered markup
 * uses. The renderer injects that CSS into a `data-velloo-adapter` <style>.
 *
 * SSR works in-process because @mui/material is a velloo dependency, so it links
 * the shared monorepo React — no dual-React hazard.
 */
export function makeRenderPass(theme: VellooTheme, dark = false): RenderPass {
  const cache = createCache({ key: "vmui", prepend: true });
  const server = createEmotionServer(cache);
  const muiTheme = muiThemeFrom(theme, dark);
  return {
    wrap: (element) =>
      createElement(
        CacheProvider,
        { value: cache },
        createElement(ThemeProvider, { theme: muiTheme }, element),
      ),
    css: (html) =>
      server
        .extractCriticalToChunks(html)
        .styles.map((s) => s.css)
        .join(""),
  };
}
