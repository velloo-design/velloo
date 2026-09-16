import type { SubCommandsDef } from "citty";
import { failWithError } from "../fail.ts";
import { strictFlags } from "../strict-flags.ts";
import { traceEnabled } from "../trace/env.ts";

/**
 * citty's lazy-command shape, extracted from its own SubCommandsDef (whose
 * CommandDef<any> deliberately erases per-command arg types — declaring our
 * own generic here would trip contravariance on every command's run()).
 */
type LazyCommand = Extract<SubCommandsDef[string], (...args: never[]) => unknown>;

const LOADERS: Record<string, LazyCommand> = {
  init: () => import("./init.ts").then((m) => m.default),
  login: () => import("./login.ts").then((m) => m.default),
  logout: () => import("./logout.ts").then((m) => m.default),
  connect: () => import("./connect.ts").then((m) => m.default),
  run: () => import("./run.ts").then((m) => m.default),
  design: () => import("./design.ts").then((m) => m.default),
  // The old name for `design`, kept working but out of help and completions.
  folder: () =>
    import("./design.ts").then((m) => ({
      ...m.default,
      meta: { name: "folder", description: "Alias of `velloo design`", hidden: true },
    })),
  mcp: () => import("./mcp.ts").then((m) => m.default),
  stop: () => import("./stop.ts").then((m) => m.default),
  status: () => import("./status.ts").then((m) => m.default),
  __daemon: () => import("./daemon.ts").then((m) => m.default),
  __update_check: () => import("./update-check.ts").then((m) => m.default),
  render: () => import("./render.ts").then((m) => m.default),
  capture: () => import("./capture.ts").then((m) => m.default),
  browser: () => import("./browser.ts").then((m) => m.default),
  export: () => import("./export.ts").then((m) => m.default),
  upgrade: () => import("./upgrade.ts").then((m) => m.default),
  publish: () => import("./publish.ts").then((m) => m.default),
  emit: () => import("./emit.ts").then((m) => m.default),
  "theme:export": () => import("./theme-export.ts").then((m) => m.default),
  completions: () => import("./completions.ts").then((m) => m.default),
  ...(traceEnabled() ? { trace: () => import("./trace.ts").then((m) => m.default) } : {}),
};

/**
 * Wrap a command so an error escaping its run() exits with one clean line
 * (`velloo <cmd>: <reason>`) instead of citty's fallback, which
 * console.errors the whole Error object — Bun renders that as a source
 * excerpt plus call stack. Commands that already fail() are unaffected;
 * this is the safety net behind them.
 */
function guarded(name: string, load: LazyCommand): LazyCommand {
  return async () => {
    const cmd = strictFlags(name, await load());
    const run = cmd.run;
    if (!run) return cmd;
    return {
      ...cmd,
      async run(ctx) {
        try {
          await run(ctx);
        } catch (err) {
          failWithError(name, err);
        }
      },
    };
  };
}

/**
 * The lazy subcommand table — one source shared by the CLI entry (cli.ts) and
 * the shell-completions generator, so completions can never drift from the
 * commands that actually exist. Names starting with `__` are internal and
 * excluded from completions.
 */
export const COMMANDS: SubCommandsDef = Object.fromEntries(
  Object.entries(LOADERS).map(([name, load]) => [name, guarded(name, load)]),
);
