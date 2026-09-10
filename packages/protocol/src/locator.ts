import { z } from "zod";

/** A node address: an index path from the tree root, or an `@id` reference. */
export type Locator = number[] | string;

/**
 * Index path from the screen tree root — `[]` is the root itself.
 *
 * Deliberately `z.number()` and not `z.number().int().nonnegative()`: Zod emits
 * that as `{minimum: 0, maximum: 9007199254740991}`, ~21 tokens of noise that
 * every agent pays in twelve tools' schemas. `resolveLocator` has to reject an
 * out-of-range index anyway, and it names the node it got to.
 */
export const PathArraySchema = z.array(z.number());

/**
 * `@id` reference like `"@hero-cta"`.
 *
 * No `.describe()`: as a member of {@link LocatorSchema} it inherits that
 * union's description, and a per-member one was emitted twelve more times
 * saying the same thing the pattern already says.
 */
export const IdLocatorSchema = z.string().regex(/^@[a-zA-Z][a-zA-Z0-9_-]*$/, {
  message: "id locator must match /^@[a-zA-Z][a-zA-Z0-9_-]*$/",
});

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

/**
 * Wrap an array schema so a single entry sent bare is lifted into a
 * one-element array.
 *
 * The bulk verbs take `patches[]` because bulk is the expensive case worth
 * making cheap — but `add_frame` sits beside `update_frame` taking flat
 * `w`/`h`, so an agent moving one frame reaches for the singular shape and
 * gets a reject for its trouble. Like `jsonTolerant` this is a tolerance and
 * not a second spelling: it stays out of the description, so nobody pays
 * tokens to learn a form they should not choose deliberately.
 */
export const singularTolerant = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === "object" && v !== null && !Array.isArray(v) ? [v] : v), schema);

/**
 * A node address, in the two forms worth advertising.
 *
 * The JSON-stringified path (`"[0,2]"`) that agents building args as JSON
 * routinely send still resolves — `jsonTolerant` parses it before validation —
 * but it is a *tolerance*, not a third form to document. It used to be a union
 * member, which meant every one of the twelve tools taking a locator paid ~14
 * tokens to advertise a spelling nobody should choose.
 */
export const LocatorSchema = jsonTolerant(z.union([PathArraySchema, IdLocatorSchema])).describe(
  'Node address: an "@id" like "@hero-cta", or an index path from the root ([0,2,1])',
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
