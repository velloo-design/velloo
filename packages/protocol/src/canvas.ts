/**
 * `@velloo/protocol/canvas` — the daemon↔canvas channel.
 *
 * A subpath because these shapes have no MCP tool behind them: the watch
 * events and socket frames are how the canvas SPA learns that a design folder
 * changed, and nothing an agent calls produces or consumes them. Mixed into
 * the root export they read like part of the agent surface, which is exactly
 * the confusion this split exists to remove.
 */
export * from "./events.ts";
