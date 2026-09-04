import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addExtension,
  type MutationContext,
  removeExtension,
  updateExtension,
} from "../../mutations/index.ts";
import { toMcp } from "./result.ts";

const PropControlSchema = z.enum(["boolean", "number", "string", "color", "enum", "icon"]);

const ExtensionPropArg = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  optional: z.boolean(),
  control: PropControlSchema,
  defaultValue: z.string().optional(),
  enumValues: z.array(z.union([z.string(), z.number()])).optional(),
});

/**
 * Sprint-Y extension lifecycle: three tools the user's agent calls to
 * declare custom components (DataTable, PriceChart, BrandHero) that
 * aren't part of any library's registry. The canvas renders these as
 * placeholder cards; codegen emits real imports to `importPath`.
 *
 * The tool descriptions intentionally read as a "skill" — they tell
 * the agent *when* to register an extension (a screen needs a
 * component the active library doesn't have), *what shape* the props
 * take, *what the canvas will show*, and *what emit_code does with
 * the importPath*. The agent should be able to operate on extensions
 * end-to-end from these descriptions alone.
 */
export function registerExtensionTools(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "add_extension",
    {
      description:
        'Register one of the app\'s own components — a bespoke DataTable, a brand Hero, a custom Chart — so screens can use it. The canvas draws a placeholder and `emit_code` writes a real import from `importPath`; `render: "live"` bundles and mounts the actual component instead (charts above all). For compositions of components that already exist, use `add_snippet`. Guide: velloo://guide/extensions.',
      inputSchema: {
        id: z.string().min(1),
        importPath: z.string().min(1),
        props: z.array(ExtensionPropArg),
        category: z.enum(["ui", "typography"]).optional(),
        description: z.string().optional(),
        render: z
          .enum(["static", "live"])
          .optional()
          .describe(
            '"live" client-mounts the real component (charts); default "static" placeholder',
          ),
        app: z
          .string()
          .min(1)
          .optional()
          .describe(
            'monorepos only: which host app the component lives in — a config.hostApps key (e.g. "web", "admin"). The live island bundles from that app\'s root + node_modules. Omit for the default host app.',
          ),
        fit: z
          .enum(["aspect-video", "content"])
          .optional()
          .describe(
            'live-island sizing: "aspect-video" (default) locks a 16:9 box; "content" lets a fixed-height chart (e.g. ResponsiveContainer height={300}) or an absolute-inset overlay drive its own height',
          ),
      },
    },
    async (args) => toMcp(await addExtension(ctx, args)),
  );

  mcp.registerTool(
    "update_extension",
    {
      description:
        "Patch an existing extension — add or remove props, fix `importPath` after a refactor, update the description. Sparse: unlisted fields keep their values. **To rename**, remove and re-add instead; renaming would break every existing tree reference.",
      inputSchema: {
        id: z.string().min(1),
        patch: z.object({
          importPath: z.string().min(1).optional(),
          props: z.array(ExtensionPropArg).optional(),
          category: z.enum(["ui", "typography"]).optional(),
          description: z.string().optional(),
          render: z.enum(["static", "live"]).optional(),
          app: z.string().min(1).optional(),
          fit: z.enum(["aspect-video", "content"]).optional(),
        }),
      },
    },
    async (args) => toMcp(await updateExtension(ctx, args)),
  );

  mcp.registerTool(
    "remove_extension",
    {
      description:
        "Unregister an extension. Refuses while any screen or snippet tree still references it, returning the offending nodes so you can remove them or swap their `$ref` first, then call again.",
      inputSchema: { id: z.string().min(1) },
    },
    async (args) => toMcp(await removeExtension(ctx, args)),
  );
}
