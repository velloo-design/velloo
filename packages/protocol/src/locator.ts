import { z } from "zod";

/** A node address: an index path from the tree root, or an `@id` reference. */
export type Locator = number[] | string;

/** Index path from the screen tree root — `[]` is the root itself. */
export const PathArraySchema = z.array(z.number().int().nonnegative());

/** `@id` reference like `"@hero-cta"`. */
export const IdLocatorSchema = z
  .string()
  .regex(/^@[a-zA-Z][a-zA-Z0-9_-]*$/, {
    message: "id locator must match /^@[a-zA-Z][a-zA-Z0-9_-]*$/",
  })
  .describe('@id reference, e.g. "@hero-cta"');

/**
 * The JSON-stringified form of a path array (`"[0,2]"`, `"[]"` for the root).
 * `resolveLocator` accepts it because agents building args as JSON routinely
 * pass the array as a string, so the schema accepts exactly what resolves —
 * every surface, not just the one whose author remembered.
 */
export const JsonPathStringSchema = z.string().regex(/^\[[\d,\s]*\]$/);

/** Any form `resolveLocator` accepts. */
export const LocatorSchema = z
  .union([PathArraySchema, IdLocatorSchema, JsonPathStringSchema])
  .describe(
    'Path from the screen tree root ([0, 2, 1]), an "@id" reference, or its JSON string form',
  );

/** A locator that defaults to the tree root when omitted. */
export const LocatorOrRootSchema = LocatorSchema.default([] as Locator);

/**
 * Locator for a node *inside a snippet body* — distinct from
 * {@link LocatorSchema} because it also allows the empty string (the body
 * root) and dotted index paths ("0.2").
 */
export const InnerPathSchema = z
  .string()
  .describe(
    'Body node: "@id" (preferred — survives restructures), a dotted index path ("0.2"), or "" for the root',
  );

/** A shallow prop/arg patch — keys merge, `null` removes a key. */
export const PatchRecordSchema = z.record(z.string(), z.unknown());

/**
 * Wrap a schema so a JSON-looking *string* is parsed before validation. Agents
 * building tool args as JSON routinely double-encode nested arrays/objects
 * (`children: "[{…}]"`, `patches: "[…]"`) — parsing at the boundary turns a
 * hard reject into a success; non-JSON strings (and already-structured values)
 * pass through untouched.
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
