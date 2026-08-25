import type { FrameworkAdapter } from "@velloo/provider";
import { renderScreen, resolveSnippetBodyForEdit, UnknownComponentError } from "@velloo/renderer";
import type { Node, Screen, Theme, Viewport } from "@velloo/schema";
import { Hono } from "hono";
import { themeByName } from "../design-folder.ts";
import { buildShowcaseTree } from "../library/showcases.ts";
import type { CanvasBundler } from "../live/canvas-bundler.ts";
import type { LiveBundler } from "../live/component-bundler.ts";
import { liveExtensions } from "../live/component-bundler.ts";
import { auditSnippet, darkModeAudit, inspect, type MutationContext } from "../mutations/index.ts";
import { providerForScreen, registryForScreen, renderPassForScreen } from "../mutations/lookup.ts";
import { pathFromString } from "../path.ts";
import type { TailwindJit } from "../styles/tailwind-jit.ts";
import { mutationToHttp } from "./error-http.ts";

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

    const w = Number(c.req.query("w")) || 480;
    const h = Number(c.req.query("h")) || 320;
    const viewport: Viewport = { w, h };

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

    try {
      const dark = c.req.query("mode") === "dark";
      const snapshotCss = await jit.build();
      const theme = themeByName(f, c.req.query("theme"));
      const { html } = await renderScreen(screen, theme, {
        viewport,
        snapshotCss,
        registry: registryForScreen(ctx, snippet),
        renderPass: renderPassForScreen(ctx, snippet, theme, dark),
        snippets: f.snippets,
        customCss: f.customCss,
        dark,
      });
      return c.body(html, 200, { "Content-Type": "text/html; charset=utf-8" });
    } catch (err) {
      if (err instanceof UnknownComponentError) {
        return c.json({ error: err.message, ref: err.ref }, 422);
      }
      throw err;
    }
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

    const w = Number(c.req.query("w")) || 480;
    const h = Number(c.req.query("h")) || 320;
    const viewport: Viewport = { w, h };

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

    try {
      const dark = c.req.query("mode") === "dark";
      const snapshotCss = await jit.build();
      const theme = themeByName(f, c.req.query("theme"));
      const { html } = await renderScreen(screen, theme, {
        viewport,
        snapshotCss,
        registry: registryForScreen(ctx, snippet),
        renderPass: renderPassForScreen(ctx, snippet, theme, dark),
        snippets: f.snippets,
        customCss: f.customCss,
        dark,
      });
      return c.body(html, 200, { "Content-Type": "text/html; charset=utf-8" });
    } catch (err) {
      if (err instanceof UnknownComponentError) {
        return c.json({ error: err.message, ref: err.ref }, 422);
      }
      throw err;
    }
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
    const f = ctx.folder;
    const componentId = c.req.param("componentId");

    const w = Number(c.req.query("w")) || 480;
    const h = Number(c.req.query("h")) || 200;
    const viewport: Viewport = { w, h };

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

    try {
      const dark = c.req.query("mode") === "dark";
      const snapshotCss = await jit.build();
      // Component previews render against the folder default library —
      // showcases live in the default-provider's surface today.
      const theme = themeByName(f, c.req.query("theme"));
      const { html } = await renderScreen(screen, theme, {
        viewport,
        snapshotCss,
        registry: registryForScreen(ctx, screen),
        renderPass: renderPassForScreen(ctx, screen, theme, dark),
        snippets: f.snippets,
        customCss: f.customCss,
        dark,
      });
      return c.body(html, 200, { "Content-Type": "text/html; charset=utf-8" });
    } catch (err) {
      if (err instanceof UnknownComponentError) {
        return c.json({ error: err.message, ref: err.ref }, 422);
      }
      throw err;
    }
  });

  r.get("/:screenId", async (c) => {
    const ctx = ctxFor();
    const f = ctx.folder;
    const screen = f.screens.get(c.req.param("screenId"));
    if (!screen) return c.json({ error: "screen not found" }, 404);

    const preset = f.config.viewportPresets[0] ?? { name: "default", w: 1440, h: 900 };
    const w = Number(c.req.query("w")) || preset.w;
    const h = Number(c.req.query("h")) || preset.h;
    const viewport: Viewport = { w, h };

    try {
      const dark = c.req.query("mode") === "dark";
      const snapshotCss = await jit.build();
      const theme = themeByName(f, c.req.query("theme"));
      const canvasBundle = await canvasBundleFor(ctx, screen, theme, dark);
      const { html } = await renderScreen(screen, theme, {
        viewport,
        snapshotCss,
        registry: registryForScreen(ctx, screen),
        renderPass: renderPassForScreen(ctx, screen, theme, dark),
        snippets: f.snippets,
        customCss: f.customCss,
        dark,
        liveBundleUrl: liveBundleUrl(ctx),
        ...(canvasBundle ? { canvasBundle } : {}),
      });
      return c.body(html, 200, { "Content-Type": "text/html; charset=utf-8" });
    } catch (err) {
      if (err instanceof UnknownComponentError) {
        return c.json({ error: err.message, ref: err.ref }, 422);
      }
      throw err;
    }
  });

  return r;
}

export function createInspectRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();

  // GET /api/inspect/dark-diff/:screenId
  r.get("/dark-diff/:screenId", async (c) => {
    const screenId = c.req.param("screenId");
    const result = await darkModeAudit(ctxFor(), { screenId });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  // GET /api/inspect/dark-diff-snippet/:snippetId
  r.get("/dark-diff-snippet/:snippetId", async (c) => {
    const snippetId = c.req.param("snippetId");
    const result = await auditSnippet(ctxFor(), { snippetId });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  // GET /api/inspect/:screenId/:path (path = dot-encoded; "" for root)
  r.get("/:screenId/:path{.*}?", async (c) => {
    const screenId = c.req.param("screenId");
    const rawPath = c.req.param("path") ?? "";
    const result = await inspect(ctxFor(), {
      screenId,
      path: pathFromString(rawPath),
    });
    return result.ok ? c.json(result.value) : mutationToHttp(c, result.error);
  });

  return r;
}
