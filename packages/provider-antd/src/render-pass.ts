import { createCache, extractStyle, StyleProvider } from "@ant-design/cssinjs";
import type { RenderPass } from "@velloo/provider";
import type { Theme as VellooTheme } from "@velloo/schema";
import { ConfigProvider } from "antd";
import { createElement } from "react";
import { antdThemeConfig } from "./theme.ts";

/**
 * A fresh cssinjs + antd render pass for one SSR. `wrap` nests the tree under
 * a per-render cssinjs StyleProvider + an antd ConfigProvider carrying the
 * projected velloo tokens (with `cssVar: true`, so `--ant-*` variables reach
 * inline styles); `css()` extracts the style rules the render registered in
 * the cache. The renderer injects that CSS into a `data-velloo-adapter`
 * <style>. Unlike emotion, cssinjs extraction reads the cache directly — the
 * rendered HTML isn't needed.
 *
 * SSR works in-process because antd is a velloo dependency, so it links the
 * shared monorepo React — no dual-React hazard.
 */
export function makeRenderPass(theme: VellooTheme, dark = false): RenderPass {
  const cache = createCache();
  const config = antdThemeConfig(theme, dark);
  return {
    wrap: (element) =>
      createElement(
        StyleProvider,
        { cache },
        createElement(ConfigProvider, { theme: config }, element),
      ),
    // `plain: true` returns bare CSS text; strip <style> wrappers defensively
    // anyway — the RenderPass contract returns CSS, not markup.
    css: () => stripStyleTags(extractStyle(cache, { plain: true })),
  };
}

function stripStyleTags(css: string): string {
  let current = css;
  for (;;) {
    const next = current.replace(/<\/?style[^>]*>/gi, "");
    if (next === current) return next;
    current = next;
  }
}
