import type { Context } from "hono";
import type { MutationError } from "../mutations/errors.ts";

export function mutationToHttp(c: Context, error: MutationError): Response {
  switch (error.kind) {
    case "ScreenNotFound":
    case "BoardNotFound":
    case "FrameNotFound":
    case "GroupNotFound":
    case "SnippetNotFound":
    case "IdNotFound":
    case "AnnotationNotFound":
    case "CanvasNoteNotFound":
    case "ExtensionNotFound":
      return c.json({ error }, 404);
    case "UnknownComponent":
    case "SnippetParamMismatch":
    case "SnippetCycle":
    case "InvalidExtensionProp":
      return c.json({ error }, 422);
    case "InvalidPath":
    case "InvalidMove":
    case "ScreenIdConflict":
    case "ScreenIdExhausted":
    case "BoardIdConflict":
    case "BoardIdExhausted":
    case "FrameIdConflict":
    case "GroupIdConflict":
    case "SnippetIdConflict":
    case "BadRequest":
      return c.json({ error }, 400);
    case "LastScreen":
    case "LastBoard":
    case "ScreenInUse":
    case "SnippetInUse":
    case "IdConflict":
    case "AnnotationConflict":
    case "ExtensionIdConflict":
    case "ExtensionInUse":
      return c.json({ error }, 409);
    default: {
      const _exhaustive: never = error;
      void _exhaustive;
      return c.json({ error: { kind: "Unknown" } }, 500);
    }
  }
}
