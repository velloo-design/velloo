import pkg from "../package.json" with { type: "json" };

/**
 * What velloo calls itself in the MCP handshake.
 *
 * It used to be a hardcoded `"0.1.0"` written out twice — in the real server
 * and in the format gate — which is a version string that would have kept
 * saying 0.1.0 through every release. An agent host that logs the server it
 * connected to would have been logging a constant.
 *
 * The build stamp (`<version> (<sha>[-dirty] · <date>)`) is baked into the
 * shipped binary by Bun.build `define`, the same one `velloo --version`
 * reports, so a session's handshake maps to an exact commit. A from-source run
 * has no define and falls back to this package's version — every workspace
 * package carries the same one, bumped together at release.
 */
declare const __VELLOO_BUILD_VERSION__: string;

export const SERVER_VERSION: string =
  typeof __VELLOO_BUILD_VERSION__ === "string" ? __VELLOO_BUILD_VERSION__ : pkg.version;

/** The `serverInfo` every velloo MCP entry point announces itself with. */
export const MCP_SERVER_INFO = { name: "velloo", version: SERVER_VERSION } as const;
