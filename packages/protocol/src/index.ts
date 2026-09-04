/**
 * `@velloo/protocol` — the Velloo wire contract.
 *
 * Everything here is a shape that crosses a process boundary: the canvas's
 * HTTP calls and socket frames, the MCP tool arguments, the typed error
 * unions clients render, the published-comment surface velloo-cloud serves,
 * and the design bundle `velloo publish` uploads.
 *
 * The rule this package exists to enforce: a type that travels between two
 * programs is declared exactly once. Before it, the canvas hand-copied the
 * server's event union and invented an error shape the server never sent, and
 * each mutation's arguments were spelled up to three different ways.
 *
 * ## Subpaths
 *
 * This root re-exports everything, which is what velloo's own packages import.
 * A reader trying to work out which shapes are stable agent surface and which
 * are one component's private RPC wants the subpaths instead:
 *
 * - `/mutations` — one argument schema per mutation, the typed errors they
 *   return, and the node addresses they take. **The agent surface.**
 * - `/cloud` — the velloo-cloud wire: response schemas, `CloudError`, and the
 *   `cloudFetch` boundary between them. Read this to run your own cloud.
 * - `/publish` — `design.json`, the design bundle a publish uploads.
 *   `/publish-meta` is the zod-only slice a cloud ingests.
 * - `/comments` — the published-comment surface. Also zod-only, for the same
 *   reason: velloo-cloud stages these files into a container with no velloo
 *   checkout.
 * - `/canvas` — watch events and socket frames. No MCP tool produces or
 *   consumes these; they are how the canvas SPA learns a folder changed.
 *
 * There is deliberately no `/mcp` subpath. A mutation's MCP shape and its HTTP
 * body are one declaration — `<Name>Body` is `z.strictObject(<Name>Shape)` —
 * and splitting them by surface would recreate exactly the duplication this
 * package was built to remove.
 */

// The root is the union of the subpaths, spelled as re-exports so the two can
// never drift. `/comments` and `/publish` stay subpath-only: they are the two
// surfaces velloo-cloud imports directly, and keeping them out of the root is
// what stops a stray `@velloo/schema` import creeping into files that must
// stay zod-only.
export * from "./canvas.ts";
export * from "./cloud.ts";
export type { PublishedThreadIsIngestible } from "./comments-compat.ts";
export * from "./mutations.ts";
