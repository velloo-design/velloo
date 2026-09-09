import type { ComponentRegistry, RenderPass } from "@velloo/provider";
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
import { type GuardedRender, type RenderFailure, renderGuarded } from "./render-guard.ts";
import { serializeTree } from "./serialize-tree.ts";
import { themeToCss } from "./theme-to-css.ts";

// The render-pass contract lives in @velloo/provider (the adapter owns it); re-exported
// here for the existing renderer import sites.
export type { RenderPass } from "@velloo/provider";

export interface RenderResult {
  html: string;
  bodyHtml: string;
  themeCss: string;
  /**
   * Components that threw and were replaced by a stand-in. Empty on a clean
   * render; the screen still rendered either way.
   */
  failures: RenderFailure[];
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
  return renderBodyGuarded(screen, registry, snippets).html;
}

/**
 * As `renderBody`, but reporting which components had to be stood in for.
 * A caller that renders a node out of its usual surroundings needs to know a
 * stand-in appeared, because out there it may mean nothing worse than "this
 * one needs its parent".
 */
export function renderBodyGuarded(
  screen: Screen,
  registry: ComponentRegistry,
  snippets?: Map<string, Snippet>,
): GuardedRender {
  ScreenSchema.parse(screen);
  return renderGuarded(registry, (active) =>
    renderToString(buildRoot(screen.tree, { registry: active, snippets })),
  );
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
  snippets?: Map<string, Snippet> | undefined;
  /** Render with the dark color block active. */
  dark?: boolean | undefined;
  /** Folder-scoped custom CSS (theme/custom.css) — injected last. */
  customCss?: string | undefined;
  /** Origin for root-relative asset URLs in out-of-origin renders. */
  baseHref?: string | undefined;
  /**
   * Root-relative URL of the live-island bundle. Set only when the screen
   * has `render:"live"` extension nodes; injects the client mount runtime.
   */
  liveBundleUrl?: string | undefined;
  /**
   * The active framework adapter's render pass (MUI/emotion). Absent for
   * Tailwind-class frameworks (shadcn / no-lib) — the SSR path is unchanged.
   */
  renderPass?: RenderPass | undefined;
  /**
   * Framework-native canvas bundle (#18): the installed-component `mountScreen`
   * URL + native theme options. When set, the document embeds the resolved tree
   * + this, and the canvas runtime client-mounts the exact installed version
   * over the SSR (which stays as the fallback). The SSR still runs — so a build
   * miss or mount failure is invisible.
   */
  canvasBundle?: { url: string; themeOptions: unknown } | undefined;
  /**
   * Include the canvas iframe runtime script (selection channel). Defaults
   * true; standalone exports pass false — the document must carry no
   * canvas-facing behavior.
   */
  includeRuntime?: boolean | undefined;
  /**
   * Let the rendered document draw its own selection box. Boards leave this
   * off — the canvas draws that chrome in the parent. See DocumentOptions.
   */
  selectionRing?: boolean | undefined;
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

  const pass = options.renderPass;
  const { html: bodyHtml, failures } = renderGuarded(options.registry, (active) => {
    const element = buildRoot(screen.tree, { registry: active, snippets: options.snippets });
    return renderToString(pass ? pass.wrap(element) : element);
  });
  // css() runs AFTER renderToString and is handed the body so emotion can extract
  // exactly the rules the rendered markup references.
  const adapterCss = pass ? pass.css(bodyHtml) : undefined;
  const themeCss = themeToCss(theme);

  // Resolve the screen to plain JSON for the client mount only when a bundle is
  // supplied; null (an unresolvable tree) drops back to SSR-only cleanly.
  const canvasBundle = options.canvasBundle
    ? (() => {
        const tree = serializeTree(screen.tree, { snippets: options.snippets });
        return tree
          ? { url: options.canvasBundle.url, tree, themeOptions: options.canvasBundle.themeOptions }
          : undefined;
      })()
    : undefined;

  const html = buildDocument({
    viewport: options.viewport,
    bodyHtml,
    snapshotCss: options.snapshotCss,
    themeCss,
    adapterCss,
    customCss: options.customCss,
    googleFonts: theme.typography.googleFonts,
    baseHref: options.baseHref,
    title: screen.name,
    dark: options.dark,
    liveBundleUrl: options.liveBundleUrl,
    canvasBundle,
    ...(options.includeRuntime !== undefined ? { includeRuntime: options.includeRuntime } : {}),
    ...(options.selectionRing !== undefined ? { selectionRing: options.selectionRing } : {}),
  });

  return { html, bodyHtml, themeCss, failures };
}
