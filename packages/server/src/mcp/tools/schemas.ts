import { ViewportSchema } from "@velloo/schema";
import { z } from "zod";

/**
 * Shared parameter schemas + validators for the MCP tools — the ones that are
 * MCP's alone. Anything an HTTP route or `batch` also validates is wire
 * contract and lives in `@velloo/protocol`; this module re-exports those under
 * the names the tool files use, and declares only what is genuinely
 * tool-surface-specific (render modes, the viewport dual form, message wording).
 */

/**
 * The locator, patch, and JSON-tolerance primitives are wire contract shared
 * with the HTTP routes and `batch`, so they are declared in
 * `@velloo/protocol` and re-exported here under the names the tool files use.
 */
export { InnerPathSchema, jsonTolerant, LocatorSchema as PathSchema } from "@velloo/protocol";
export { NodeIdSchema as NodeIdInputSchema } from "@velloo/schema";
export { ViewportSchema };

/**
 * The viewport as a tool *argument*, which is a looser thing than the viewport
 * on disk: `{ width, height }` is what an agent writes first, every browser API
 * having taught it that spelling, and the reject buys nothing. Normalized here
 * rather than in `@velloo/schema` because `ViewportSchema` is also the persisted
 * shape — config presets, the publish bundle — and input tolerance has no
 * business widening a file format.
 */
export const ViewportArgSchema = z.preprocess((v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return v;
  const o = v as Record<string, unknown>;
  if (o.w !== undefined || o.h !== undefined) return v;
  const { width, height, ...rest } = o;
  return width === undefined && height === undefined ? v : { ...rest, w: width, h: height };
}, ViewportSchema);

/** A named theme to render with (boards pin one). */
export const ThemeNameSchema = z
  .string()
  .optional()
  .describe("Named theme to render with (boards pin one)");

/** Render mode for the screenshot/snippet renderers. */
export const RenderModeSchema = z.enum(["light", "dark", "compare"]).optional();
