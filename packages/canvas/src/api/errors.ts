/**
 * Turning the server's typed failures into something a person can read.
 *
 * The canvas used to declare its own approximation of this payload — an
 * interface with a `code` field the server never sent and a `message` field
 * that exists on only 5 of the 28 `MutationError` variants. Everything else
 * fell through to a generated fallback, so a missing screen surfaced as
 * "mutate/add_node: 404" while the server's actual explanation (and, for an
 * unknown component, its ranked suggestions) was serialized, shipped, and
 * dropped on the floor.
 *
 * Both sides now read `@velloo/protocol`, and the `never` guard at the end of
 * the switch makes a new server-side variant a compile error here rather than
 * a silent regression to a status-code string.
 */
import {
  type CloudError,
  isCloudErrorKind,
  type MutationError,
  type ThemeError,
} from "@velloo/protocol";

/**
 * A failure a cloud-backed route re-serves (asset generation today).
 *
 * The route sends the `CloudError` kind alongside the sentence it already
 * rendered, rather than a shape of its own: the wording belongs to whoever
 * knows what failed, and `LoggedOut` is the one kind the canvas must *act* on
 * rather than print. `AssetInUse` is the assets router's own refusal.
 */
type CloudRouteError = { kind: CloudError["kind"] | "AssetInUse"; message: string };

export type ApiError = MutationError | ThemeError | CloudRouteError;

const isCloudRouteError = (error: ApiError): error is CloudRouteError =>
  error.kind === "AssetInUse" || isCloudErrorKind(error.kind);

/**
 * Whether this failure is fixed by signing in — the canvas answers these with
 * the sign-in dialog rather than a toast the user can only read.
 */
export function isSignInRequired(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (error as Error & { payload?: ApiError }).payload?.kind === "LoggedOut";
}

const list = (items: string[]): string => items.join(", ");

function baseMessage(error: ApiError): string {
  // Already a sentence, written where the failure happened. Split out so the
  // `never` guard below stays total over the two unions the canvas owns.
  if (isCloudRouteError(error)) return error.message;
  switch (error.kind) {
    // `BadRequest` is the one kind both unions carry; both spell it `message`.
    case "BadRequest":
      return error.message;

    // Mutations — not found
    case "ScreenNotFound":
      return `No screen "${error.screenId}".`;
    case "BoardNotFound":
      return `No board "${error.boardId}".`;
    case "FrameNotFound":
      return `No frame "${error.frameId}" on board "${error.boardId}".`;
    case "BoardGroupNotFound":
      return `No board group "${error.groupId}".`;
    case "SnippetNotFound":
      return `No snippet "${error.snippetId}".`;
    case "IdNotFound":
      return `No node with id "${error.id}" on "${error.screenId}".`;
    case "AnnotationNotFound":
      return `No annotation "${error.annotationId}" on "${error.screenId}".`;
    case "CanvasNoteNotFound":
      return `No note "${error.noteId}".`;

    // Mutations — rejected content
    case "UnknownComponent":
      return error.suggestions.length > 0
        ? `No component "${error.ref}". Did you mean ${list(error.suggestions)}?`
        : `No component "${error.ref}".`;
    case "InvalidPath":
    case "InvalidMove":
      return error.reason;
    case "SnippetParamMismatch":
      return `Snippet "${error.snippetId}": ${error.reason}`;
    case "SnippetCycle":
      return `Snippet "${error.snippetId}" would contain itself (via ${list(error.viaPath)}).`;
    case "InvalidExtensionProp":
      return error.message;

    // Mutations — conflicts
    case "LastScreen":
      return "A folder needs at least one screen.";
    case "ScreenIdConflict":
      return `A screen called "${error.screenId}" already exists.`;
    case "BoardIdConflict":
      return `A board called "${error.boardId}" already exists.`;
    case "SnippetIdConflict":
      return `A snippet called "${error.snippetId}" already exists.`;
    case "FrameIdConflict":
      return `Board "${error.boardId}" already has a frame "${error.frameId}".`;
    case "ScreenIdExhausted":
    case "BoardIdExhausted":
      return `Ran out of unique ids based on "${error.base}".`;
    case "IdConflict":
      return `"${error.screenId}" already has ${error.paths.length} nodes with id "${error.id}".`;
    case "AnnotationConflict":
      return "That node already has an annotation.";
    case "SnippetInUse":
      return `Snippet "${error.snippetId}" is still used on ${list(
        error.screenIds,
      )} — remove those first.`;
    case "ExtensionIdConflict":
    case "ExtensionNotFound":
    case "ExtensionInUse":
      return error.message;

    // Theme
    case "InvalidColor":
    case "InvalidThemePath":
      return error.reason;
    case "UnknownPreset":
      return `No preset "${error.presetName}".`;
    case "BulkTokensInvalid":
      return `${error.failed.length} token${error.failed.length === 1 ? "" : "s"} rejected: ${list(
        error.failed.map((f) => `${f.path} (${f.reason})`),
      )}. Nothing was saved.`;

    default: {
      const exhaustive: never = error;
      void exhaustive;
      return "The change could not be applied.";
    }
  }
}

/** A sentence describing the failure, plus the server's hint when it sent one. */
export function describeApiError(error: ApiError): string {
  const base = baseMessage(error);
  const hint = "hint" in error && typeof error.hint === "string" ? error.hint : undefined;
  return hint ? `${base} ${hint}` : base;
}
