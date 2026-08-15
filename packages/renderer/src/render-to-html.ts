import type { ComponentRegistry } from "@velloo/provider";
import {
  type Screen,
  ScreenSchema,
  type Snippet,
  type Theme,
  ThemeSchema,
  type Viewport,
} from "@velloo/schema";
import { renderToString } from "react-dom/server";
import { buildRoot } from "./build-tree.ts";
import { buildDocument } from "./document.ts";
import { themeToCss } from "./theme-to-css.ts";

export interface RenderResult {
  html: string;
  bodyHtml: string;
  themeCss: string;
}

/**
 * Render just the inner body HTML for a screen — no document chrome, no
 * CSS. Used by inspect-style callers that only need the SSR'd subtree.
 * Pass `snippets` if the tree may contain `$snippet` instances.
 */
export function renderBody(
  screen: Screen,
  registry: ComponentRegistry,
  snippets?: Map<string, Snippet>,
): string {
  ScreenSchema.parse(screen);
  return renderToString(buildRoot(screen.tree, { registry, snippets }));
}

export interface RenderOptions {
  /** Viewport size to render at (frame size). */
  viewport: Viewport;
  /**
   * Tailwind CSS compiled against the design folder's components + screens.
   * The server's TailwindJit produces this; the renderer stays pure.
   */
  snapshotCss: string;
  /** Component registry from the active provider. */
  registry: ComponentRegistry;
  /** Snippets registry — required if the screen tree contains $snippet nodes. */
  snippets?: Map<string, Snippet>;
  /** Render with the dark color block active. */
  dark?: boolean;
}

/**
 * Render a single screen against a theme + viewport to a self-contained HTML
 * document. Pure: caller supplies the compiled CSS so we don't reach into the
 * file system here.
 */
export async function renderScreen(
  screen: Screen,
  theme: Theme,
  options: RenderOptions,
): Promise<RenderResult> {
  ScreenSchema.parse(screen);
  ThemeSchema.parse(theme);

  const element = buildRoot(screen.tree, {
    registry: options.registry,
    snippets: options.snippets,
  });
  const bodyHtml = renderToString(element);
  const themeCss = themeToCss(theme);

  const html = buildDocument({
    viewport: options.viewport,
    bodyHtml,
    snapshotCss: options.snapshotCss,
    themeCss,
    title: screen.name,
    dark: options.dark,
  });

  return { html, bodyHtml, themeCss };
}
