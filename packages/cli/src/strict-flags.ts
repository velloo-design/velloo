import type { ArgsDef, CommandDef } from "citty";
import { fail } from "./fail.ts";
import { firstPositional } from "./subcommands.ts";

/**
 * Retired flags a command still accepts without listing them. A 0.1.x
 * `velloo upgrade` installs the new build and then runs it as
 * `velloo upgrade <folder> --folder-only`, so that spelling has to keep working.
 */
const TOLERATED: Record<string, string[]> = { upgrade: ["folder-only"] };

/** Flags citty answers itself, on every command. */
const BUILTIN_FLAGS = ["help", "h", "version", "v"];

const camel = (name: string): string =>
  name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

async function knownFlags<A extends ArgsDef>(args: CommandDef<A>["args"]): Promise<Set<string>> {
  const defs: ArgsDef = (typeof args === "function" ? await args() : await args) ?? {};
  const known = new Set(BUILTIN_FLAGS);
  for (const [name, def] of Object.entries(defs)) {
    if (def.type === "positional") continue;
    const alias = "alias" in def ? def.alias : undefined;
    for (const spelling of [name, ...(alias === undefined ? [] : [alias].flat())]) {
      known.add(spelling);
      known.add(camel(spelling));
      known.add(kebab(spelling));
    }
  }
  return known;
}

/** The flag names a raw argv mentions, up to a `--` terminator. */
function flagsIn(rawArgs: readonly string[]): string[] {
  const flags: string[] = [];
  for (const token of rawArgs) {
    if (token === "--") break;
    if (!token.startsWith("-") || token === "-" || /^-\d/.test(token)) continue;
    if (token.startsWith("--")) {
      const name = token.slice(2).split("=")[0] ?? "";
      flags.push(name.startsWith("no-") ? name.slice(3) : name);
    } else {
      // `-abc` is three short flags.
      flags.push(...(token.slice(1).split("=")[0]?.split("") ?? []));
    }
  }
  return flags;
}

/**
 * citty parses flags loosely, so a mistyped or outdated one (`--mcp-port`) is
 * silently ignored and the command runs with defaults. Reject it instead,
 * naming the flags the command does take. A subcommand is checked against its
 * own flags; a command that also runs itself (`publish [design]` beside
 * `publish list`) is checked only when no subcommand is named.
 */
export function strictFlags<A extends ArgsDef>(name: string, cmd: CommandDef<A>): CommandDef<A> {
  const subCommands = cmd.subCommands;
  const table = async () =>
    typeof subCommands === "function" ? await subCommands() : await subCommands;
  const checked: CommandDef<A> = subCommands
    ? {
        ...cmd,
        subCommands: async () =>
          Object.fromEntries(
            Object.entries((await table()) ?? {}).map(([child, load]) => [
              child,
              async () => {
                const def = typeof load === "function" ? await load() : await load;
                return strictFlags(`${name} ${child}`, def);
              },
            ]),
          ),
      }
    : cmd;
  if (subCommands && !cmd.run) return checked;
  const setup = cmd.setup;
  return {
    ...checked,
    async setup(context) {
      if (subCommands) {
        const child = await firstPositional(context.rawArgs, cmd.args);
        if (child !== undefined && Object.hasOwn((await table()) ?? {}, child)) {
          await setup?.(context);
          return;
        }
      }
      const known = await knownFlags(cmd.args);
      const tolerated = TOLERATED[name] ?? [];
      const unknown = flagsIn(context.rawArgs).filter(
        (flag) => flag !== "" && !known.has(flag) && !tolerated.includes(flag),
      );
      if (unknown.length > 0) {
        const listed = [...known].filter(
          (f) => f.length > 1 && !BUILTIN_FLAGS.includes(f) && f === kebab(f),
        );
        const hint =
          listed.length > 0 ? ` (it takes ${listed.map((f) => `--${f}`).join(", ")})` : "";
        fail(
          name,
          `unknown option ${unknown.map((f) => (f.length === 1 ? `-${f}` : `--${f}`)).join(", ")}${hint}`,
        );
      }
      await setup?.(context);
    },
  };
}
