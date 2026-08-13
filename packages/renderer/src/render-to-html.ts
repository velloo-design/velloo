import { type Snippet, type Theme, ThemeSchema, type Variant, VariantSchema } from "@velloo/schema";
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
 * Render just the inner body HTML for a variant — no document chrome, no
 * CSS. Used by inspect-style callers that only need the SSR'd subtree.
 * Pass `snippets` if the tree may contain `$snippet` instances.
 */
export function renderBody(variant: Variant, snippets?: Map<string, Snippet>): string {
  VariantSchema.parse(variant);
  return renderToString(buildRoot(variant.tree, { snippets }));
}

export interface RenderOptions {
  /**
   * Tailwind CSS compiled against the snapshot + page folder. The server's
   * TailwindJit produces this; the renderer stays pure (no file I/O).
   */
  snapshotCss: string;
  /** Snippets registry — required if the variant tree contains $snippet nodes. */
  snippets?: Map<string, Snippet>;
  /** Render with the dark color block active. */
  dark?: boolean;
}

/**
 * Render a single variant against a theme to a self-contained HTML document.
 * Pure: caller supplies the snapshot CSS so we don't reach into the file
 * system here.
 */
export async function renderVariant(
  variant: Variant,
  theme: Theme,
  options: RenderOptions,
): Promise<RenderResult> {
  // Defense-in-depth: validate inputs at the public boundary.
  VariantSchema.parse(variant);
  ThemeSchema.parse(theme);

  const element = buildRoot(variant.tree, { snippets: options.snippets });
  const bodyHtml = renderToString(element);
  const themeCss = themeToCss(theme);

  const html = buildDocument({
    viewport: variant.viewport,
    bodyHtml,
    snapshotCss: options.snapshotCss,
    themeCss,
    title: variant.name,
    dark: options.dark,
  });

  return { html, bodyHtml, themeCss };
}
