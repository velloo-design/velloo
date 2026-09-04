/**
 * `@velloo/protocol` — the Velloo wire contract.
 *
 * Everything here is a shape that crosses a process boundary: the canvas's
 * HTTP calls and socket frames, the MCP tool arguments, the typed error
 * unions clients render, and the published-comment surface velloo-cloud
 * serves. It depends only on `@velloo/schema` and zod, so any side of any of
 * those boundaries can import it.
 *
 * The rule this package exists to enforce: a type that travels between two
 * programs is declared exactly once. Before it, the canvas hand-copied the
 * server's event union and invented an error shape the server never sent, and
 * each mutation's arguments were spelled up to three different ways.
 *
 * The published-comment surface is also reachable as `@velloo/protocol/comments`
 * — a subpath so velloo-cloud can take the wire contract without the mutation
 * schemas, which mean nothing to it.
 */

export {
  CLOUD_ERROR_CODES,
  type CloudErrorBody,
  type CloudErrorCode,
  isCloudErrorCode,
} from "./cloud-codes.ts";
export type { PublishedThreadIsIngestible } from "./comments-compat.ts";
export type {
  ErrorEnvelope,
  ErrorOf,
  KindedError,
  MutationError,
  ThemeError,
} from "./errors.ts";
export {
  ACTIVITY_EVENT_TYPE,
  parseSocketFrame,
  type SocketFrame,
  SocketFrameSchema,
  type WatchEvent,
} from "./events.ts";
export {
  IdLocatorSchema,
  InnerPathSchema,
  JsonPathStringSchema,
  jsonTolerant,
  type Locator,
  LocatorOrRootSchema,
  LocatorSchema,
  PatchRecordSchema,
  PathArraySchema,
} from "./locator.ts";
export * from "./mutations.ts";
