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
export {
  IdLocatorSchema as IdLocator,
  InnerPathSchema,
  jsonTolerant,
  LocatorSchema as PathSchema,
  PatchRecordSchema,
} from "@velloo/protocol";
export { NodeIdSchema as NodeIdInputSchema } from "@velloo/schema";
export { ViewportSchema };

/** A named theme to render with (boards pin one). */
export const ThemeNameSchema = z
  .string()
  .optional()
  .describe("Named theme to render with (boards pin one)");

/** Render mode for the screenshot/snippet renderers. */
export const RenderModeSchema = z.enum(["light", "dark", "compare"]).optional();

/**
 * Resolve the flat `w`/`h` + `viewport` object dual form shared by screenshot
 * and compare_to_url: explicit flat `w`/`h` win, else fall back to the object.
 */
export function resolveViewport(
  w: number | undefined,
  h: number | undefined,
  viewport: { w: number; h: number } | undefined,
): { w: number | undefined; h: number | undefined } {
  return { w: w ?? viewport?.w, h: h ?? viewport?.h };
}

/**
 * Consistent error messages for the single-or-bulk param shape shared by
 * update_props / update_frame / set_token — pass EITHER the single fields OR a
 * bulk array, never both, never neither. The control flow stays per-tool (so
 * the single fields narrow naturally); only the message wording is shared.
 */
export const singleOrBulkError = {
  both: (tool: string, single: string, bulk: string): string =>
    `${tool}: pass either ${single} or ${bulk}, not both.`,
  missing: (tool: string, single: string, bulk: string): string =>
    `${tool}: ${single} required (or pass ${bulk}).`,
};
