import type { CodegenError } from "@velloo/codegen";
import type { Context } from "hono";
import type { MutationError } from "../mutations/errors.ts";
import type { ThemeError } from "../theme/errors.ts";

/**
 * Single source of truth for error-kind → HTTP status. The Record types
 * are total over each union's `kind`, so adding a variant without
 * classifying it here is a compile error — same guarantee the old
 * per-file switch + `never` guards gave, with one table per union
 * instead of three switch statements to keep in sync.
 */
type ErrorStatus = 400 | 404 | 409 | 422 | 503;

const MUTATION_STATUS: Record<MutationError["kind"], ErrorStatus> = {
  ScreenNotFound: 404,
  BoardNotFound: 404,
  FrameNotFound: 404,
  GroupNotFound: 404,
  SnippetNotFound: 404,
  IdNotFound: 404,
  AnnotationNotFound: 404,
  CanvasNoteNotFound: 404,
  ExtensionNotFound: 404,
  UnknownComponent: 422,
  SnippetParamMismatch: 422,
  SnippetCycle: 422,
  InvalidExtensionProp: 422,
  InvalidPath: 400,
  InvalidMove: 400,
  ScreenIdConflict: 400,
  ScreenIdExhausted: 400,
  BoardIdConflict: 400,
  BoardIdExhausted: 400,
  FrameIdConflict: 400,
  GroupIdConflict: 400,
  SnippetIdConflict: 400,
  BadRequest: 400,
  LastScreen: 409,
  LastBoard: 409,
  ScreenInUse: 409,
  SnippetInUse: 409,
  IdConflict: 409,
  AnnotationConflict: 409,
  ExtensionIdConflict: 409,
  ExtensionInUse: 409,
};

const THEME_STATUS: Record<ThemeError["kind"], ErrorStatus> = {
  UnknownPreset: 404,
  InvalidColor: 400,
  InvalidThemePath: 400,
  BadRequest: 400,
  ImageLoadFailed: 422,
  LlmUnavailable: 503,
};

const CODEGEN_STATUS: Record<CodegenError["kind"], ErrorStatus> = {
  ScreenNotFound: 404,
  SnippetNotFound: 404,
  UnknownComponent: 422,
};

export function mutationToHttp(c: Context, error: MutationError): Response {
  return c.json({ error }, MUTATION_STATUS[error.kind]);
}

export function themeToHttp(c: Context, error: ThemeError): Response {
  return c.json({ error }, THEME_STATUS[error.kind]);
}

export function codegenToHttp(c: Context, error: CodegenError): Response {
  return c.json({ error }, CODEGEN_STATUS[error.kind]);
}
