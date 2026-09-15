import { z } from "zod";

/**
 * Server → client push events, broadcast over the canvas WebSocket.
 *
 * This union is the wire contract, not an internal detail: the server emits it
 * and the canvas dispatches on it, so it lives here rather than beside the
 * watcher that happens to produce most of the variants. Some are emitted by
 * other server paths entirely (`folder-reloaded` by the host-source
 * watcher, `reload-error` by the reload pipeline).
 */
export type WatchEvent =
  | { type: "screen-changed"; screenId: string }
  | { type: "board-changed"; boardId: string }
  | { type: "theme-changed" }
  | { type: "snippet-changed"; snippetId: string }
  | { type: "annotations-changed"; screenId: string }
  | { type: "notes-changed"; boardId: string }
  | { type: "comments-changed"; boardId: string; scope: "local" | "shared" }
  /**
   * `.design/config.json` changed — typically a Sprint-Y
   * `add_extension` / `update_extension` / `remove_extension`
   * mutation. The canvas refreshes its Library tab so new extensions
   * appear without a full page reload.
   */
  | { type: "config-changed" }
  /**
   * Host component source changed, so any rendered frame may be stale.
   * Clients drop every cache and refetch. Emitted by the host-source
   * watcher, never by the design-folder watcher.
   */
  | { type: "folder-reloaded" }
  /**
   * A watched file changed but failed to reload into memory
   * (unparseable JSON, schema violation). Emitted by the server's
   * reload pipeline rather than the watcher itself; clients surface it
   * so an on-disk edit is never silently dropped while the canvas
   * keeps rendering stale state.
   */
  | { type: "reload-error"; source: string; message: string };

/**
 * Presentation-only agent-activity metadata rides the same socket but
 * is not a `WatchEvent` — it never triggers a refetch. Clients validate the
 * body separately; the discriminant is all this schema needs to route it.
 */
export const ACTIVITY_EVENT_TYPE = "activity";

/**
 * Runtime validator for a frame arriving on the socket. The canvas cannot
 * trust `JSON.parse` output, and a hand-written `as WatchEvent` there is
 * exactly the drift this package exists to prevent — so the parse lives with
 * the type it produces.
 *
 * Unknown `type` values parse successfully into the passthrough branch: the
 * server may add an event this client predates, and dropping the frame is the
 * client's decision to make on a known-shaped value, not a parse failure.
 */
export const SocketFrameSchema = z.union([
  z.object({ type: z.literal("screen-changed"), screenId: z.string().min(1) }),
  z.object({ type: z.literal("board-changed"), boardId: z.string().min(1) }),
  z.object({ type: z.literal("theme-changed") }),
  z.object({ type: z.literal("snippet-changed"), snippetId: z.string().min(1) }),
  z.object({ type: z.literal("annotations-changed"), screenId: z.string().min(1) }),
  z.object({ type: z.literal("notes-changed"), boardId: z.string().min(1) }),
  z.object({
    type: z.literal("comments-changed"),
    boardId: z.string().min(1),
    scope: z.enum(["local", "shared"]),
  }),
  z.object({ type: z.literal("config-changed") }),
  z.object({ type: z.literal("folder-reloaded") }),
  z.object({
    type: z.literal("reload-error"),
    source: z.string(),
    message: z.string(),
  }),
  z.object({ type: z.literal(ACTIVITY_EVENT_TYPE) }).loose(),
]);

export type SocketFrame = z.infer<typeof SocketFrameSchema>;

/** Parse a raw socket payload, returning null for anything unusable. */
export function parseSocketFrame(data: unknown): SocketFrame | null {
  if (typeof data !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  const result = SocketFrameSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
