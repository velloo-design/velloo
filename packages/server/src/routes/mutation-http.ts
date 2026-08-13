import type { Context } from "hono";
import type { MutationError } from "../mutations/errors.ts";

/**
 * Map a MutationError variant to the right HTTP response. The exhaustive
 * `switch` plus the `const _: never` guard means adding a new MutationError
 * variant fails the build here until it's handled.
 */
export function mutationToHttp(c: Context, error: MutationError): Response {
  switch (error.kind) {
    case "PageNotFound":
    case "VariantNotFound":
    case "SnippetNotFound":
    case "IdNotFound":
    case "AnnotationNotFound":
    case "CanvasNoteNotFound":
      return c.json({ error }, 404);
    case "UnknownComponent":
    case "SnippetParamMismatch":
    case "SnippetCycle":
      return c.json({ error }, 422);
    case "InvalidPath":
    case "InvalidMove":
    case "VariantIdConflict":
    case "PageIdExhausted":
    case "SnippetIdConflict":
    case "BadRequest":
      return c.json({ error }, 400);
    case "LastPage":
    case "LastVariant":
    case "SnippetInUse":
    case "IdConflict":
    case "AnnotationConflict":
      return c.json({ error }, 409);
    default: {
      const _exhaustive: never = error;
      void _exhaustive;
      return c.json({ error: { kind: "Unknown" } }, 500);
    }
  }
}
