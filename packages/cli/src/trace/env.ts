/**
 * The trace recorder (server) and its `velloo trace` visualizer are one hidden
 * debug surface, gated behind a single env var. Unset ⇒ the subcommand isn't
 * registered (so it stays out of `velloo --help`) and the daemon doesn't record.
 *
 * NOTE: the recorder reads this same var in the *daemon* process, so the value
 * must be present when the daemon is spawned — see `velloo run`/`velloo mcp`.
 */
const TRACE_ENV = "VELLOO_TRACE";

export function traceEnabled(): boolean {
  const v = process.env[TRACE_ENV];
  return v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";
}
