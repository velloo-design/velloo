import { existsSync } from "node:fs";

/**
 * The flags every Bun process that runs Velloo is started with.
 *
 * `--no-install`: from a directory with no `node_modules` above it, Bun
 * resolves a bare import out of its global cache and downloads what the cache
 * lacks. Velloo resolves from the user's app, which is such a directory
 * whenever the app is not a Node project, so left on this fetched packages the
 * app never named. There is no environment switch for it and `bunfig.toml` is
 * read from the working directory, which is the user's: the flag has to ride on
 * every command line that starts Bun — the npm launcher (`launcher.cjs`), the
 * direct archive's wrapper (`scripts/build-direct-artifact.ts`), and each
 * re-spawn below.
 */
export const BUN_RUNTIME_FLAGS: readonly string[] = ["--no-install"];

/**
 * This same CLI as a child's command line. From a script that is
 * `bun <flags> cli.js …`; a compiled binary has no entry file on disk and takes
 * its arguments directly.
 */
export function selfCommand(args: readonly string[]): string[] {
  const entry = Bun.main;
  return existsSync(entry)
    ? [process.execPath, ...BUN_RUNTIME_FLAGS, entry, ...args]
    : [process.execPath, ...args];
}
