import { ViewportSchema } from "@velloo/schema";
import { z } from "zod";

/**
 * Shared parameter schemas + validators for the MCP tools. Centralizing these
 * keeps the surface consistent: one locator definition instead of five, one
 * viewport object instead of three inline copies, one single-or-bulk validator
 * instead of per-tool reimplementations. Import from here rather than redefining.
 */

export { ViewportSchema };

/** `@id` reference like `"@hero-cta"`. */
export const IdLocator = z
  .string()
  .regex(/^@[a-zA-Z][a-zA-Z0-9_-]*$/)
  .describe('@id reference, e.g. "@hero-cta"');

/**
 * The JSON-stringified form of a path array (`"[0,2]"`, `"[]"` for the root).
 * `resolveLocator` tolerates it because agents building batch args as JSON
 * routinely pass the array as a string; accept it at the boundary too so the
 * locator schema matches what actually resolves.
 */
const JsonArrayLocator = z.string().regex(/^\[[\d,\s]*\]$/);

/** A node locator: a path array from the tree root, an `@id`, or the JSON string of a path array. */
export const PathSchema = z
  .union([z.array(z.number().int().nonnegative()), IdLocator, JsonArrayLocator])
  .describe(
    'Path from the screen tree root ([0, 2, 1]), an "@id" reference, or its JSON string form',
  );

/** Stable id for a node — letters/digits/_/- with a leading letter. */
export const NodeIdInputSchema = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/)
  .describe("Stable id for the node (letters/digits/_/-, leading letter)");

/**
 * Locator for a node *inside a snippet body* — distinct from {@link PathSchema}
 * because it also allows the empty string (the body root) and dotted index
 * paths ("0.2"). Shared by override_snippet_props, update_snippet's innerPatch,
 * and inspect.
 */
export const InnerPathSchema = z
  .string()
  .describe(
    'Body node: "@id" (preferred — survives restructures), a dotted index path ("0.2"), or "" for the root',
  );

/**
 * Wrap a schema so a JSON-looking *string* is parsed before validation. Agents building
 * tool args as JSON routinely double-encode nested arrays/objects (`children: "[{…}]"`,
 * `patches: "[…]"`) — parsing at the boundary turns a hard reject into a success; non-JSON
 * strings (and already-structured values) pass through untouched.
 */
export const jsonTolerant = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => {
    if (typeof v === "string") {
      const t = v.trim();
      if (t.startsWith("[") || t.startsWith("{")) {
        try {
          return JSON.parse(t);
        } catch {
          /* leave as-is; the inner schema will produce its own error */
        }
      }
    }
    return v;
  }, schema);

/** A shallow prop/arg patch — keys merge, `null` removes a key. */
export const PatchRecordSchema = z.record(z.string(), z.unknown());

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
