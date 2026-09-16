import type { ArgsDef, CommandDef, SubCommandsDef } from "citty";

type Resolvable<T> = T | Promise<T> | (() => T) | (() => Promise<T>);

async function resolve<T>(value: Resolvable<T>): Promise<T> {
  return typeof value === "function" ? await (value as () => T | Promise<T>)() : await value;
}

/**
 * The first positional token in `rawArgs` — what citty would take as a
 * subcommand name. A string flag written without `=` consumes the next token.
 */
export async function firstPositional(
  rawArgs: readonly string[],
  args: CommandDef["args"],
): Promise<string | undefined> {
  const defs: ArgsDef = args ? await resolve(args) : {};
  const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  const takesValue = (flag: string): boolean => {
    const name = camel(flag.replace(/^-{1,2}/, ""));
    return Object.entries(defs).some(([key, def]) => {
      if (def.type !== "string" && def.type !== "enum") return false;
      const aliases = "alias" in def && def.alias !== undefined ? [def.alias].flat() : [];
      return camel(key) === name || aliases.includes(name);
    });
  };
  for (let i = 0; i < rawArgs.length; i++) {
    const token = rawArgs[i] ?? "";
    if (token === "--") return undefined;
    if (token.startsWith("-")) {
      if (!token.includes("=") && takesValue(token)) i++;
      continue;
    }
    return token;
  }
  return undefined;
}

/**
 * Give a command that takes a positional of its own (`publish [design]`)
 * subcommands too (`publish list`). citty sends any first positional to the
 * subcommand table, so `velloo publish web` would fail as an unknown command;
 * here the command runs itself unless that positional names a subcommand —
 * which makes the subcommand names reserved words for its positional.
 */
export function withSubcommands<A extends ArgsDef>(
  cmd: CommandDef<A>,
  subCommands: SubCommandsDef,
): CommandDef<A> {
  // Unset until setup: help and completions introspect the full table.
  let chosen: string | undefined | null = null;
  const dispatches = (name: string | undefined | null): boolean =>
    name === null || (name !== undefined && Object.hasOwn(subCommands, name));
  return {
    ...cmd,
    subCommands: () => (dispatches(chosen) ? subCommands : {}),
    async setup(context) {
      chosen = await firstPositional(context.rawArgs, cmd.args);
      if (!dispatches(chosen)) await cmd.setup?.(context);
    },
    async run(context) {
      if (!dispatches(chosen)) await cmd.run?.(context);
    },
  };
}
