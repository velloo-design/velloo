import { z } from "zod";

/**
 * The one id format for on-disk resources (screens, boards, groups, frames,
 * snippets, annotations, notes): URL- and filename-safe, no dots (filename
 * stems double as ids and the loader treats dotted stems as sidecars), max 64.
 * Node `$id`s are stricter (letter-led — see `NodeIdSchema`) because they
 * double as `@id` locator references.
 */
export const ResourceIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, "ids are [A-Za-z0-9][A-Za-z0-9_-]{0,63}");

export type ResourceId = z.infer<typeof ResourceIdSchema>;
