import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { measureRendered } from "@velloo/renderer";
import { z } from "zod";
import { pinnedThemeForScreen, resolveNamedTheme } from "../../design-folder.ts";
import type { CanvasBundler } from "../../live/canvas-bundler.ts";
import type { LiveBundler } from "../../live/component-bundler.ts";
import { findNodes, inspect, type MutationContext } from "../../mutations/index.ts";
import { resolve as resolveLocator } from "../../mutations/lookup.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";
import { childrenMeasuredAt, measuredAt } from "./computed.ts";
import { FindNodesOutput } from "./outputs.ts";
import { errorResult, jsonResult, structuredResult } from "./result.ts";
import { PathSchema, RenderModeSchema, ThemeNameSchema, ViewportArgSchema } from "./schemas.ts";
import {
  captureTimeoutMessage,
  defaultViewport,
  makeCanvasBundle,
  makeLiveUrl,
  mountDiagnostics,
  renderForCapture,
} from "./screenshot-helpers.ts";

export function registerInspectTool(
  mcp: McpServer,
  ctx: MutationContext,
  jit: TailwindJit,
  bundler: LiveBundler,
  canvasBundler: CanvasBundler,
  assetOrigin?: string,
): void {
  const liveUrl = makeLiveUrl(ctx, bundler);
  const canvasBundle = makeCanvasBundle(ctx, canvasBundler);

  mcp.registerTool(
    "inspect",
    {
      description:
        "Return the node's server-rendered HTML, resolved className list, $ref, and resolved props for the node at path. Use this instead of guessing the rendered output. The HTML comes from Velloo's bundled library; where the screen mounts the app's own components (component_status { screen }), the canvas and captures show those instead, so measure them with `computed: true`. When path resolves to a snippet instance, pass innerPath to inspect a node *inside* the resolved body (args, $overrides, and $extraClassName applied) — omit it to inspect the body root. Pass `computed: true` to also render the screen in a real browser and report the node's actual geometry and resolved styles — use it instead of predicting which utility class won the cascade.",
      inputSchema: {
        screenId: z.string(),
        path: PathSchema,
        innerPath: z
          .string()
          .optional()
          .describe(
            'For a snippet instance: a dotted index path like "0.2", an "@id" of a node in the body, or "" for the body root (the default). Ignored for plain components.',
          ),
        computed: z
          .boolean()
          .optional()
          .describe(
            "Measure the node in a real browser: box geometry and resolved computed styles, plus its direct children's boxes. Costs a render, so it's off by default.",
          ),
        viewport: ViewportArgSchema.optional().describe(
          "Render size for `computed`; defaults to the folder's Desktop preset",
        ),
        mode: RenderModeSchema.describe("Render variant for `computed`"),
        theme: ThemeNameSchema.describe("Named theme for `computed`"),
      },
    },
    async (args) => {
      const result = await inspect(ctx, args);
      if (!result.ok) return errorResult(result.error);
      if (args.computed !== true) return jsonResult(result.value);

      const screen = ctx.folder.screens.get(args.screenId);
      if (!screen) return errorResult(`Screen not found: ${args.screenId}`);
      // A node inside a snippet body has no `data-node-path` of its own — the
      // resolved tree bakes the *instance* path — so a computed measurement
      // would silently land on the instance. Say so rather than mislead.
      if (args.innerPath !== undefined && args.innerPath !== "") {
        return jsonResult({
          ...result.value,
          computed: null,
          computedNote:
            "A node inside a snippet body isn't separately addressable in the render — it carries the instance's path. Measure the instance, or render the snippet with render_snippet.",
        });
      }
      const located = resolveLocator(screen.tree, args.path, args.screenId);
      if (!located.ok) return errorResult(located.error);
      const path = located.value;

      let themeName = args.theme;
      if (themeName === undefined) {
        const pinned = pinnedThemeForScreen(ctx.folder, args.screenId);
        if (!pinned.ok) return errorResult(pinned.message);
        themeName = pinned.name;
      }
      const themeRes = resolveNamedTheme(ctx.folder, themeName);
      if (!themeRes.ok) return errorResult(themeRes.message);
      const defaults = defaultViewport(ctx.folder);
      const viewport = { w: args.viewport?.w ?? defaults.w, h: args.viewport?.h ?? defaults.h };

      try {
        const html = await renderForCapture(ctx, screen, {
          theme: themeRes.theme,
          dark: args.mode === "dark",
          viewport,
          snapshotCss: await jit.build(),
          liveUrl,
          canvasBundle,
          assetOrigin,
        });
        const dom = await measureRendered({ html, viewport });
        const node = measuredAt(dom, path);
        const diagnostics = await mountDiagnostics(ctx, canvasBundler, screen);
        return jsonResult({
          ...result.value,
          ...(diagnostics.length > 0 ? { diagnostics } : {}),
          computed: node ? { viewport, ...node, children: childrenMeasuredAt(dom, path) } : null,
          ...(node
            ? {}
            : {
                computedNote:
                  "The node rendered nothing measurable — it is display:none, zero-area, or its component drops the props it was given. A zero-area box is itself the finding.",
              }),
        });
      } catch (err) {
        const timeout = captureTimeoutMessage(err, "inspect");
        return errorResult(timeout ?? `inspect: computed measurement failed: ${String(err)}`);
      }
    },
  );

  mcp.registerTool(
    "find_nodes",
    {
      description:
        'Query a screen tree for nodes matching filters (ANDed): exact $ref, exact $snippet, exact $id, className substring, or prop presence/value. Use this to locate targets for update_props/move_node instead of fetching and walking the whole tree. Example: { screenId: "home", ref: "Icon", prop: "name", propValue: "Github" }.',
      outputSchema: FindNodesOutput,
      inputSchema: {
        screenId: z.string(),
        ref: z.string().optional().describe("Exact component $ref, e.g. 'Button'"),
        snippetId: z.string().optional().describe("Exact $snippet id for snippet instances"),
        id: z.string().optional().describe("Exact $id anchor"),
        classContains: z.string().optional().describe("Substring of props.className"),
        prop: z.string().optional().describe("Prop key that must be present"),
        propValue: z.unknown().optional().describe("With prop: strict-equal value match"),
        limit: z.number().int().positive().optional().describe("Max matches; default 50"),
      },
    },
    async (args) => {
      const result = await findNodes(ctx, args);
      return result.ok ? structuredResult({ ...result.value }) : errorResult(result.error);
    },
  );
}
