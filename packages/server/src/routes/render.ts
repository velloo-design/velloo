import type { FrameworkAdapter } from "@velloo/provider";
import { renderScreen, resolveSnippetBodyForEdit, UnknownComponentError } from "@velloo/renderer";
import type { Node, Screen, Snippet, Theme, Viewport } from "@velloo/schema";
import { type Context, Hono } from "hono";
import { themeByName } from "../design-folder.ts";
import { buildShowcaseTree } from "../library/showcases.ts";
import type { CanvasBundler } from "../live/canvas-bundler.ts";
import type { LiveBundler } from "../live/component-bundler.ts";
import { liveExtensions } from "../live/component-bundler.ts";
import type { MutationContext } from "../mutations/index.ts";
import { providerForScreen, registryForScreen, renderPassForScreen } from "../mutations/lookup.ts";
import type { TailwindJit } from "../styles/tailwind-jit.ts";

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
   * The framework-native canvas bundle wiring for a screen (#18): the
   * installed-component `mountScreen` URL + native theme options, or undefined
   * when the screen's adapter declares no `canvasBundleSpec` OR the build
   * failed (framework not installed) — both keep the canvas on SSR. Awaits the
   * (cached) build so a build miss never embeds a dead bundle URL.
   */
  const canvasBundleFor = async (
    ctx: MutationContext,
    screen: Pick<Screen, "library">,
    theme: Theme,
    dark: boolean,
  ): Promise<{ url: string; themeOptions: unknown } | undefined> => {
    const provider = providerForScreen(ctx, screen) as FrameworkAdapter;
    // The bundler builds the default provider's components, so only a
    // default-library screen can mount against it (a non-default-library screen
    // in a multi-library folder keeps SSR — see makeCanvasBundle).
    if (provider !== ctx.defaultProvider) return undefined;
    if (!provider.canvasBundleSpec || !provider.themeToNative) return undefined;
    const { errors } = await canvasBundler.build();
    if (errors.length > 0) return undefined;
    return {
      url: `/api/canvas/bundle.js?v=${canvasBundler.version}`,
      themeOptions: provider.themeToNative(theme, dark),
    };
  };

  const parseViewport = (c: Context, dw: number, dh: number): Viewport => ({
    w: Number(c.req.query("w")) || dw,
    h: Number(c.req.query("h")) || dh,
  });

  /**
   * The shared tail of every preview route: JIT css → theme (`?theme`) →
   * dark (`?mode`) → renderScreen → HTML, with UnknownComponentError as a 422.
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
    },
  ): Promise<Response> => {
    const { ctx, screen, viewport } = opts;
    const f = ctx.folder;
    const owner = opts.libraryOf ?? screen;
    try {
      const dark = c.req.query("mode") === "dark";
      const snapshotCss = await jit.build();
      const theme = themeByName(f, c.req.query("theme"));
      const canvasBundle = opts.withBundles
        ? await canvasBundleFor(ctx, screen, theme, dark)
        : undefined;
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
      });
      return c.body(html, 200, { "Content-Type": "text/html; charset=utf-8" });
    } catch (err) {
      if (err instanceof UnknownComponentError) {
        return c.json({ error: err.message, ref: err.ref }, 422);
      }
      throw err;
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
     * Fill required params (no default) with friendly placeholders so
     * the thumbnail never crashes the renderer. Optional params get
     * their declared defaults via the snippet body's `$param` lookup.
     */
    const args: Record<string, unknown> = {};
    for (const p of snippet.params) {
      if (p.default !== undefined) continue;
      if (p.type === "string") args[p.name] = p.name;
      else if (p.type === "number") args[p.name] = 0;
      else if (p.type === "boolean") args[p.name] = false;
      else if (p.type === "node") args[p.name] = { $ref: "Text", props: { children: p.name } };
      else if (p.type === "icon") args[p.name] = "Circle";
      else if (p.type === "color") args[p.name] = "#7c3aed";
      else if (p.type === "enum") args[p.name] = p.enum?.[0] ?? "";
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

    return renderPreview(c, { ctx, screen, viewport, libraryOf: snippet });
  });

  /**
   * Render a snippet *body* (not the instance wrapper) — used by the
   * canvas's snippet editor view. Substitutes `$param` references in
   * prop positions with their declared defaults, but leaves `$param`
   * nodes as small placeholder badges so the body's path space stays
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
      if (p.default !== undefined) {
        paramDefaults[p.name] = p.default;
        continue;
      }
      // Type-aware fallbacks for required params so the edit-preview
      // doesn't crash on a missing arg. Mirrors `/snippet/:id`.
      if (p.type === "string") paramDefaults[p.name] = `$${p.name}`;
      else if (p.type === "number") paramDefaults[p.name] = 0;
      else if (p.type === "boolean") paramDefaults[p.name] = false;
      else if (p.type === "icon") paramDefaults[p.name] = "Circle";
      else if (p.type === "color") paramDefaults[p.name] = "#7c3aed";
      else if (p.type === "enum") paramDefaults[p.name] = p.enum?.[0] ?? "";
      else paramDefaults[p.name] = `$${p.name}`;
    }

    const tree = resolveSnippetBodyForEdit(snippet.tree, paramDefaults, snippet.id);
    const screen: Screen = {
      id: `${snippet.id}__body`,
      name: `${snippet.name} body`,
      tree,
    };

    return renderPreview(c, { ctx, screen, viewport, libraryOf: snippet });
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
