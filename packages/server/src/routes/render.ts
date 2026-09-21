import { randomBytes } from "node:crypto";
import {
  RenderGuardLimitError,
  renderScreen,
  resolveSnippetBodyForEdit,
  snippetParamPlaceholder,
} from "@velloo/renderer";
import {
  isComponentNode,
  isRepoNode,
  isSnippetInstance,
  type Node,
  type Screen,
  type Snippet,
  type Viewport,
} from "@velloo/schema";
import { type Context, Hono } from "hono";
import { themeByName } from "../design-folder.ts";
import { buildShowcaseTree } from "../library/showcases.ts";
import type { CanvasBundler } from "../live/canvas-bundler.ts";
import type { LiveBundler } from "../live/component-bundler.ts";
import { liveExtensions } from "../live/component-bundler.ts";
import { makeCanvasBundle } from "../mcp/tools/screenshot-helpers.ts";
import type { MutationContext } from "../mutations/index.ts";
import { registryForScreen, renderPassForScreen } from "../mutations/lookup.ts";
import type { TailwindJit } from "../styles/tailwind-jit.ts";
import { renderErrorDocument } from "./render-error.ts";

/**
 * Rendered documents are same-origin with the canvas, whose `/api/*` routes are
 * unauthenticated, and they inline design-authored SVG behind a sanitizer. The
 * policy only allows same-origin scripts (the live and canvas bundles) and the
 * inline runtimes carrying this response's nonce, so a sanitizer bypass has
 * nothing to execute. Styles, fonts and images stay unrestricted: designs load
 * Google Fonts and remote imagery.
 */
function renderCsp(nonce: string): string {
  return `script-src 'self' 'nonce-${nonce}'; object-src 'none'; base-uri 'self'`;
}

/**
 * Render a screen as standalone HTML. The viewport size for responsive Tailwind
 * comes from query params (?w=...&h=...) — defaults to the first viewport
 * preset if missing. Used by the canvas to mount a screen inside each frame
 * iframe at the frame's current size.
 */
export function createRenderRouter(
  ctxFor: () => MutationContext,
  jit: TailwindJit,
  bundler: LiveBundler,
  canvasBundler: CanvasBundler,
): Hono {
  const r = new Hono();

  /**
   * Root-relative live-island bundle URL, or undefined when the folder has
   * no `render:"live"` extensions. Cache-busted by the bundler version so a
   * host edit re-fetches. Folder-scoped, so it's the same for every screen.
   */
  const liveBundleUrl = (ctx: MutationContext): string | undefined =>
    Object.keys(liveExtensions(ctx.folder.config.extensions)).length > 0
      ? `/api/live/bundle.js?v=${bundler.version}`
      : undefined;

  /**
   * The client-mount wiring for a screen — the same decision screenshots,
   * compare and export make (see `screenMount`), so what the canvas shows is
   * what every capture shows.
   */
  const canvasBundleFor = (ctx: MutationContext) => makeCanvasBundle(ctx, canvasBundler);

  const parseViewport = (c: Context, dw: number, dh: number): Viewport => ({
    w: Number(c.req.query("w")) || dw,
    h: Number(c.req.query("h")) || dh,
  });

  /**
   * The shared tail of every preview route: JIT css → theme (`?theme`) →
   * dark (`?mode`) → renderScreen → HTML, with what the render guard could not
   * contain as a 500 error document.
   * `libraryOf` picks the registry/pass owner when it isn't the rendered
   * screen (snippet previews resolve their snippet's library); `withBundles`
   * mounts the live-island + installed-component bundles (screen frames only —
   * snippet/component tiles keep the lean SSR path).
   */
  const renderPreview = async (
    c: Context,
    opts: {
      ctx: MutationContext;
      screen: Screen;
      viewport: Viewport;
      libraryOf?: Pick<Screen, "library"> | Pick<Snippet, "library">;
      withBundles?: boolean;
      /** Client-mount only when the tree has repository components. */
      repoMount?: boolean;
      selectionRing?: boolean;
    },
  ): Promise<Response> => {
    const { ctx, screen, viewport } = opts;
    const f = ctx.folder;
    const owner = opts.libraryOf ?? screen;
    const dark = c.req.query("mode") === "dark";
    const nonce = randomBytes(16).toString("base64");
    const headers = {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": renderCsp(nonce),
    };
    try {
      const snapshotCss = await jit.build();
      const theme = themeByName(f, c.req.query("theme"));
      // Snippet tiles stay on the lean server render, except that a snippet
      // built from repository components has nothing real to show without the
      // browser mount.
      const mount = opts.withBundles || (opts.repoMount && usesRepo(screen.tree, f.snippets));
      const canvasBundle = mount ? await canvasBundleFor(ctx)(screen, theme, dark) : undefined;
      const { html } = await renderScreen(screen, theme, {
        viewport,
        snapshotCss,
        registry: registryForScreen(ctx, owner),
        renderPass: renderPassForScreen(ctx, owner, theme, dark),
        snippets: f.snippets,
        customCss: f.customCss,
        dark,
        ...(opts.withBundles ? { liveBundleUrl: liveBundleUrl(ctx) } : {}),
        ...(canvasBundle ? { canvasBundle } : {}),
        ...(opts.selectionRing ? { selectionRing: true } : {}),
        scriptNonce: nonce,
      });
      return c.body(html, 200, headers);
    } catch (err) {
      // The frame is an iframe, so its only way of saying anything is a
      // document. Statuses stay as they were — the canvas reads them — but the
      // body is now something a person can act on rather than a blank rect.
      const page =
        err instanceof RenderGuardLimitError
          ? {
              title: "Too many broken components",
              lede: "Each of these could have been replaced with a placeholder on its own, but a screen with this many is not worth drawing around. Every other screen is unaffected.",
              detail: err.failures
                .map((failure) => `${failure.componentId}: ${failure.reason}`)
                .join("\n"),
              hint: "Most of these are parts placed without their parent. Fix a few and the rest of the screen draws again.",
            }
          : {
              title: "This screen didn't render",
              lede: "Something failed that the canvas could not pin on a single node, so it could not stand in for it and draw the rest. Every other screen is unaffected.",
              detail: err instanceof Error ? err.message : String(err),
              hint: "The message above is the renderer's own. It usually names the snippet or the node it choked on.",
            };
      return c.body(renderErrorDocument({ ...page, screenName: screen.name, dark }), 500, headers);
    }
  };

  /**
   * Render a snippet in isolation as live HTML. Wraps the snippet in a
   * synthetic single-node screen (mirroring how the MCP render_snippet
   * tool works) so the same renderer code path handles both. Defaults
   * fill required params with placeholder strings — the agent can
   * always override via ?arg.<name>=<value> in a future iteration.
   *
   * The snippet instance is wrapped in a centering Card so previews —
   * library masonry tiles, snippet detail pages — render in the
   * middle of their iframe with breathing room around them, instead
   * of pinned to the top-left.
   */
  r.get("/snippet/:snippetId", async (c) => {
    const ctx = ctxFor();
    const f = ctx.folder;
    const snippet = f.snippets.get(c.req.param("snippetId"));
    if (!snippet) return c.json({ error: "snippet not found" }, 404);

    const viewport = parseViewport(c, 480, 320);

    /**
     * Fill required params (no default) with placeholders so the thumbnail
     * never crashes the renderer, using the same table the editor preview
     * does — a slot reads as `$name` in both, not as content here and as a
     * tag there. A param with a declared default is left out: the snippet
     * body's own `$param` lookup supplies it.
     */
    const args: Record<string, unknown> = {};
    for (const p of snippet.params) {
      if (p.default !== undefined) continue;
      args[p.name] = snippetParamPlaceholder(p);
    }

    const snippetInstance: Node = {
      $snippet: snippet.id,
      ...(Object.keys(args).length > 0 ? { args } : {}),
    };
    const screen: Screen = {
      id: `${snippet.id}__preview`,
      name: `${snippet.name} preview`,
      tree: {
        $ref: "Card",
        props: {
          className:
            "min-h-screen w-full flex items-center justify-center p-6 ring-0 shadow-none bg-transparent rounded-none",
          "data-velloo-snippet-preview": "true",
        },
        children: [snippetInstance],
      },
    };

    return renderPreview(c, { ctx, screen, viewport, libraryOf: snippet, repoMount: true });
  });

  /**
   * Render a snippet *body* (not the instance wrapper) — used by the
   * canvas's snippet editor view. Substitutes `$param` references in
   * prop positions with their declared defaults, but leaves `$param`
   * nodes as small placeholder tags so the body's path space stays
   * intact. Clicks in the iframe report paths that match the snippet
   * tree, which the canvas maps to `update_props` calls against the
   * virtualized `snippet:<id>` screenId.
   */
  r.get("/snippet-body/:snippetId", async (c) => {
    const ctx = ctxFor();
    const f = ctx.folder;
    const snippet = f.snippets.get(c.req.param("snippetId"));
    if (!snippet) return c.json({ error: "snippet not found" }, 404);

    const viewport = parseViewport(c, 480, 320);

    const paramDefaults: Record<string, unknown> = {};
    for (const p of snippet.params) {
      paramDefaults[p.name] = snippetParamPlaceholder(p);
    }

    const tree = resolveSnippetBodyForEdit(snippet.tree, paramDefaults, snippet.id);
    const screen: Screen = {
      id: `${snippet.id}__body`,
      name: `${snippet.name} body`,
      tree,
    };

    // Nothing draws selection chrome over this iframe — there is no board
    // frame around it — so the document draws its own.
    return renderPreview(c, {
      ctx,
      screen,
      viewport,
      libraryOf: snippet,
      repoMount: true,
      selectionRing: true,
    });
  });

  /**
   * Render a single component in isolation. Used by Library tiles and the
   * variant matrix on the detail page. The `?props` query carries a JSON
   * object that overrides the top-level component's props — so the same
   * endpoint serves the tile (default props) and every cell of the
   * variants matrix (per-cell overrides).
   *
   * Routed before `/:screenId` so `/component/:id` doesn't get swallowed
   * by the screen catch-all.
   */
  r.get("/component/:componentId", async (c) => {
    const ctx = ctxFor();
    const componentId = c.req.param("componentId");

    const viewport = parseViewport(c, 480, 200);

    const rawProps = c.req.query("props");
    let propOverrides: Record<string, unknown> | undefined;
    if (rawProps) {
      try {
        const parsed = JSON.parse(rawProps);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          propOverrides = parsed as Record<string, unknown>;
        }
      } catch {
        return c.json({ error: "invalid props JSON" }, 400);
      }
    }

    const inner = buildShowcaseTree(componentId, propOverrides);
    // Center the component inside the iframe — without this wrapper the
    // Screen body lays out at the top-left and previews look stranded.
    // `min-h-screen` makes the wrapper fill whatever viewport size the
    // Library tile / variants matrix asked for via `?w` / `?h`.
    const tree: Node = {
      $ref: "Card",
      props: {
        className:
          "min-h-screen w-full flex items-center justify-center p-4 ring-0 shadow-none bg-transparent rounded-none",
      },
      children: [inner],
    };

    const screen: Screen = {
      id: `${componentId}__preview`,
      name: `${componentId} preview`,
      tree,
    };

    // Component previews render against the folder default library —
    // showcases live in the default-provider's surface today.
    return renderPreview(c, { ctx, screen, viewport });
  });

  /**
   * One of the app's own components, mounted for real — the Library's Repo
   * tiles and detail preview. `?state=` picks a catalog preview state by
   * index; the component is centered like any other library tile.
   */
  r.get("/repo/:componentId", async (c) => {
    const ctx = ctxFor();
    const catalog = ctx.repo ? await ctx.repo.catalog().catch(() => null) : null;
    const entry = catalog?.byId.get(c.req.param("componentId"));
    if (!entry) return c.json({ error: "repository component not found" }, 404);
    const state = entry.states[Number(c.req.query("state") ?? 0)]?.props ?? {};
    const props: Record<string, unknown> =
      Object.keys(state).length > 0
        ? { ...state }
        : entry.acceptsChildren
          ? { children: entry.name }
          : {};
    // A catalog key (`repo::./src/x#Name`) is not a valid screen id.
    const screen: Screen = {
      id: "repo-preview",
      name: `${entry.name} preview`,
      tree: { $ref: entry.name, $repo: entry.identity, props },
    };
    return renderPreview(c, {
      ctx,
      screen,
      viewport: parseViewport(c, 480, 200),
      repoMount: true,
    });
  });

  r.get("/:screenId", async (c) => {
    const ctx = ctxFor();
    const f = ctx.folder;
    const screen = f.screens.get(c.req.param("screenId"));
    if (!screen) return c.json({ error: "screen not found" }, 404);

    const preset = f.config.viewportPresets[0] ?? { name: "default", w: 1440, h: 900 };
    const viewport = parseViewport(c, preset.w, preset.h);

    return renderPreview(c, { ctx, screen, viewport, withBundles: true });
  });

  return r;
}

function usesRepo(node: Node, snippets: Map<string, Snippet>, seen = new Set<string>()): boolean {
  if (isSnippetInstance(node)) {
    const snippet = snippets.get(node.$snippet);
    if (!snippet || seen.has(snippet.id)) return false;
    return usesRepo(snippet.tree, snippets, new Set([...seen, snippet.id]));
  }
  if (!isComponentNode(node)) return false;
  return isRepoNode(node) || (node.children ?? []).some((child) => usesRepo(child, snippets, seen));
}
