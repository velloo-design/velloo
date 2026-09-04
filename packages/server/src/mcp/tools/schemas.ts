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
