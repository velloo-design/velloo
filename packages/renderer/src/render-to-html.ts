import { type Theme, ThemeSchema, type Variant, VariantSchema } from "@velloo/schema";
import { loadCss } from "@velloo/shadcn-snapshot";
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
 * Render a single variant against a theme to a self-contained HTML document.
 * Pure function modulo the snapshot CSS file read on first call.
 */
export async function renderVariant(variant: Variant, theme: Theme): Promise<RenderResult> {
  // Defense-in-depth: validate inputs at the public boundary.
  VariantSchema.parse(variant);
  ThemeSchema.parse(theme);

  const element = buildRoot(variant.tree);
  const bodyHtml = renderToString(element);
  const themeCss = themeToCss(theme);
  const snapshotCss = await loadCss();

  const html = buildDocument({
    viewport: variant.viewport,
    bodyHtml,
    snapshotCss,
    themeCss,
    title: variant.name,
  });

  return { html, bodyHtml, themeCss };
}
