/**
 * The typed error unions the server returns and its clients render.
 *
 * These are wire types, so they live here rather than in the server: the
 * canvas has no dependency path to `@velloo/server` and previously
 * hand-declared its own approximation of this shape, which drifted (it
 * described a `code` field that never existed and a `message` present on only
 * a handful of variants). Both sides now read the same declaration.
 *
 * Constructors stay server-side — they carry agent-facing hint prose and the
 * nearest-component search — but every `kind` a client can receive is here.
 */

/** Mutation failure modes. Pair with `Result<T, MutationError>`. */
export type MutationError =
  | { kind: "ScreenNotFound"; screenId: string }
  | { kind: "BoardNotFound"; boardId: string }
  | { kind: "FrameNotFound"; boardId: string; frameId: string }
  | { kind: "BoardGroupNotFound"; groupId: string }
  | { kind: "UnknownComponent"; ref: string; suggestions: string[]; hint?: string }
  | { kind: "InvalidPath"; reason: string; path?: number[]; hint?: string }
  | { kind: "InvalidMove"; reason: string }
  | { kind: "LastScreen"; screenId: string }
  | { kind: "ScreenIdConflict"; screenId: string; hint?: string }
  | { kind: "ScreenIdExhausted"; base: string }
  | { kind: "BoardIdConflict"; boardId: string }
  | { kind: "BoardIdExhausted"; base: string }
  | { kind: "FrameIdConflict"; boardId: string; frameId: string }
  /** Request body failed zod validation. */
  | { kind: "BadRequest"; message: string; issues?: unknown; hint?: string }
  | { kind: "SnippetNotFound"; snippetId: string }
  | { kind: "SnippetParamMismatch"; snippetId: string; reason: string; details?: unknown }
  | { kind: "SnippetCycle"; snippetId: string; viaPath: string[] }
  | { kind: "SnippetInUse"; snippetId: string; screenIds: string[]; snippetIds: string[] }
  | { kind: "SnippetIdConflict"; snippetId: string }
  | { kind: "IdNotFound"; screenId: string; id: string; hint?: string }
  | { kind: "IdConflict"; screenId: string; id: string; paths: number[][] }
  | {
      kind: "AnnotationConflict";
      screenId: string;
      locator: number[] | string;
      existingId: string;
    }
  | { kind: "AnnotationNotFound"; screenId: string; annotationId: string }
  | { kind: "CanvasNoteNotFound"; noteId: string }
  | { kind: "ExtensionIdConflict"; extensionId: string; message: string }
  | { kind: "ExtensionNotFound"; extensionId: string; message: string }
  | {
      kind: "ExtensionInUse";
      extensionId: string;
      message: string;
      references: { screenId: string; path: string }[];
    }
  | {
      kind: "InvalidExtensionProp";
      extensionId: string;
      message: string;
      prop: string;
    };

/** Theme failure modes. Same shape rules as {@link MutationError}. */
export type ThemeError =
  | { kind: "InvalidColor"; reason: string; hint?: string }
  | { kind: "InvalidThemePath"; reason: string; hint?: string }
  | { kind: "UnknownPreset"; presetName: string; hint?: string }
  | { kind: "BadRequest"; message: string; issues?: unknown }
  | {
      kind: "BulkTokensInvalid";
      /**
       * Paths that validated cleanly, in application order. The batch is
       * all-or-nothing — when any entry fails, NOTHING is persisted, so these
       * report what *would* have applied, not a half-written state.
       */
      applied: string[];
      failed: { path: string; reason: string }[];
    };

/** The discriminant every typed error union in this repo shares. */
export type KindedError = { kind: string };

/** Narrow a union to one variant: `ErrorOf<MutationError, "ScreenNotFound">`. */
export type ErrorOf<E extends KindedError, K extends E["kind"]> = Extract<E, { kind: K }>;

/** The error envelope every failing HTTP route returns. */
export interface ErrorEnvelope<E extends KindedError = MutationError | ThemeError> {
  error: E;
}
