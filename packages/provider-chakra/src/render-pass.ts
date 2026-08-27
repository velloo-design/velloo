import { ChakraProvider, extendTheme } from "@chakra-ui/react";
import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import createEmotionServer from "@emotion/server/create-instance";
import type { RenderPass } from "@velloo/provider";
import type { Theme as VellooTheme } from "@velloo/schema";
import { createElement } from "react";
import { chakraThemeOptions } from "./theme.ts";

/**
 * A fresh emotion + chakra render pass for one SSR. `wrap` nests the tree
 * under a per-render emotion CacheProvider + a ChakraProvider carrying
 * `extendTheme` over the projected velloo tokens; `css(html)` extracts the
 * emotion rules the render registered — including chakra's Global styles
 * (the `--chakra-*` CSS variables every component references), which
 * `extractCriticalToChunks` keeps because globals are never in
 * `cache.registered`. The renderer injects that CSS into a
 * `data-velloo-adapter` <style>.
 *
 * SSR works in-process because @chakra-ui/react is a velloo dependency, so it
 * links the shared monorepo React — no dual-React hazard.
 */
export function makeRenderPass(theme: VellooTheme, dark = false): RenderPass {
  const cache = createCache({ key: "vchakra", prepend: true });
  const server = createEmotionServer(cache);
  const chakraTheme = extendTheme(chakraThemeOptions(theme, dark));
  return {
    wrap: (element) =>
      createElement(
        CacheProvider,
        { value: cache },
        createElement(
          ChakraProvider,
          { theme: chakraTheme },
          // The projected theme already carries real dark values at :root, but
          // the data-theme/classname scope also switches chakra's own `_dark`
          // component styling (whiteAlpha borders etc.) — ColorModeScript
          // would set these on <html> in a real app; SSR has no client pass.
          createElement(
            "div",
            {
              "data-theme": dark ? "dark" : "light",
              className: dark ? "chakra-ui-dark" : "chakra-ui-light",
            },
            element,
          ),
        ),
      ),
    css: (html) =>
      server
        .extractCriticalToChunks(html)
        .styles.map((s) => s.css)
        .join(""),
  };
}
