import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addExtension,
  type MutationContext,
  removeExtension,
  updateExtension,
} from "../../mutations/index.ts";

const PropControlSchema = z.enum(["boolean", "number", "string", "color", "enum", "icon"]);

const ExtensionPropArg = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  optional: z.boolean(),
  control: PropControlSchema,
  defaultValue: z.string().optional(),
  enumValues: z.array(z.union([z.string(), z.number()])).optional(),
});

function jsonResult(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function errorResult(value: unknown): {
  isError: true;
  content: { type: "text"; text: string }[];
} {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(value) }] };
}

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
      description: [
        "Register a user-owned custom component into this design folder so it can appear in screen trees.",
        "",
        "**When to use.** A screen needs a component the active library doesn't have — your app's bespoke DataTable, a brand-specific Hero, a custom Chart. The user already implements it in their app; this tool tells Velloo about it: the canvas renders a dashed placeholder card (id + resolved props + importPath — good enough to design layout against) and `emit_code` produces a correct import.",
        "",
        "**Don't use it for.** Compositions of existing components (use `add_snippet` — snippets are subtrees with typed params). Swapping a whole library palette (pin the screen's `library` instead). Variations on an existing component (use props or class overrides).",
        "",
        "**Props schema.** Each prop entry has `name`, `type` (free-form TS-shaped string for display), `optional`, and a `control` of `boolean | number | string | color | enum | icon` (`enum` also takes `enumValues: string[]`). `defaultValue` (string) shows in the placeholder when the prop isn't set. Mirrors a library component's manifest entry — the inspector renders the same controls.",
        "",
        '**Live preview (`render: "live"`).** For components whose visual fidelity needs the real implementation — charts above all — pass `render: "live"`: Velloo bundles the actual component from your app (resolved from `importPath` against the host app + its `node_modules`) and client-mounts it in the canvas. The component must be browser-renderable (no server-only imports); the preview is visual-only (clicks select the node), and any bundle/render failure falls back to the placeholder. The built-in `Chart` node already previews via echarts and needs no extension; use `render:"live"` for your own chart components.',
        "",
        '**Codegen.** `emit_code` writes `import { <id> } from "<importPath>"` exactly as supplied — use the alias your app actually uses (`@/components/data-table`).',
        "",
        "**Shadowing.** An extension shadows a library component with the same id (your `Button` wins over shadcn's on every screen); the response surfaces `shadowedLibraryComponent` when this happens so you can rename if unintentional.",
        "",
        "**Example.** Register a custom live chart:",
        '  add_extension({ id: "PriceChart", importPath: "@/components/charts/PriceChart", render: "live", props: [{ name: "data", type: "Point[]", optional: false, control: "string" }], description: "Recharts price chart" })',
      ].join("\n"),
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
        fit: z
          .enum(["aspect-video", "content"])
          .optional()
          .describe(
            'live-island sizing: "aspect-video" (default) locks a 16:9 box; "content" lets a fixed-height chart (e.g. ResponsiveContainer height={300}) or an absolute-inset overlay drive its own height',
          ),
      },
    },
    async (args) => {
      const r = await addExtension(ctx, args);
      if (r.ok) return jsonResult(r.value);
      return errorResult(r.error);
    },
  );

  mcp.registerTool(
    "update_extension",
    {
      description: [
        "Patch an existing extension. Use to add or remove props (a new column in a DataTable), change the importPath after a refactor, or update the description.",
        "",
        "**To rename an extension**, call `remove_extension` and `add_extension` instead — renaming would break every existing tree reference. Velloo refuses removal when references exist, so a rename naturally surfaces them.",
        "",
        "Pass only the fields you want to change in `patch`. Other fields keep their current values.",
      ].join("\n"),
      inputSchema: {
        id: z.string().min(1),
        patch: z.object({
          importPath: z.string().min(1).optional(),
          props: z.array(ExtensionPropArg).optional(),
          category: z.enum(["ui", "typography"]).optional(),
          description: z.string().optional(),
          render: z.enum(["static", "live"]).optional(),
          fit: z.enum(["aspect-video", "content"]).optional(),
        }),
      },
    },
    async (args) => {
      const r = await updateExtension(ctx, args);
      if (r.ok) return jsonResult(r.value);
      return errorResult(r.error);
    },
  );

  mcp.registerTool(
    "remove_extension",
    {
      description: [
        "Remove an extension from the folder. Refuses if any screen or snippet tree still references the extension — returns the list of offending nodes so the agent can remove or replace them first.",
        "",
        "Typical sequence to unregister a now-unused custom component:",
        "  1. call this tool; if it returns ExtensionInUse, the response carries the references",
        "  2. walk the references and `remove_node` (or `update_props` to swap the $ref) for each",
        "  3. call this tool again",
      ].join("\n"),
      inputSchema: { id: z.string().min(1) },
    },
    async (args) => {
      const r = await removeExtension(ctx, args);
      if (r.ok) return jsonResult(r.value);
      return errorResult(r.error);
    },
  );
}
