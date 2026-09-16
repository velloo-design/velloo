import type { ArgsDef, CommandDef, CommandMeta, SubCommandsDef } from "citty";
import { COMMANDS } from "../commands/registry.ts";

/** Unwrap citty's Resolvable<T> (plain value, or sync/async factory). */
async function resolvable<T>(value: T | (() => T | Promise<T>)): Promise<T> {
  return typeof value === "function" ? await (value as () => T | Promise<T>)() : value;
}

interface FlagSpec {
  /** The flag as the user types it (kebab-case, `--no-` form for default-true booleans). */
  flag: string;
  description: string;
  /** Whether the flag takes a value (non-boolean). */
  takesValue: boolean;
}

export interface CommandSpec {
  name: string;
  description: string;
  flags: FlagSpec[];
  /** One level of subcommands (`theme export`), each with its own flags. */
  subcommands: CommandSpec[];
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * One-line, shell-safe description: first line only, with the characters that
 * break zsh `_describe`/`_arguments` specs and fish `-d` strings stripped.
 */
function sanitize(desc: string | undefined): string {
  return (
    (desc ?? "")
      .split("\n")[0]
      ?.replace(/['"[\]:`$\\]/g, "")
      .trim() ?? ""
  );
}

function flagSpecs(args: ArgsDef): FlagSpec[] {
  const flags: FlagSpec[] = [];
  for (const [argName, def] of Object.entries(args)) {
    if (def.type === "positional") continue;
    const isBool = def.type === "boolean";
    const negated = isBool && (def as { default?: unknown }).default === true;
    flags.push({
      flag: negated ? `--no-${kebab(argName)}` : `--${kebab(argName)}`,
      description: sanitize(def.description),
      takesValue: !isBool,
    });
  }
  return flags;
}

/** A visible command's spec, or null for a hidden one or one that fails to load. */
async function commandSpec(
  name: string,
  load: SubCommandsDef[string],
  depth: number,
): Promise<CommandSpec | null> {
  let cmd: CommandDef;
  let meta: CommandMeta | undefined;
  let args: ArgsDef;
  try {
    cmd = await resolvable(load);
    meta = cmd.meta ? await resolvable(cmd.meta) : undefined;
    args = cmd.args ? await resolvable(cmd.args) : {};
  } catch {
    return null;
  }
  if (meta?.hidden) return null;
  const subcommands: CommandSpec[] = [];
  if (depth === 0 && cmd.subCommands) {
    for (const [child, loadChild] of Object.entries(await resolvable(cmd.subCommands))) {
      const spec = await commandSpec(child, loadChild, depth + 1);
      if (spec) subcommands.push(spec);
    }
  }
  return {
    name,
    description: sanitize(meta?.description),
    flags: flagSpecs(args),
    subcommands,
  };
}

/**
 * Introspect the live citty command table into a completion spec.
 * Internal (`__`-prefixed) and hidden commands are excluded; boolean flags that default
 * to true surface as their `--no-` form (the only form worth typing).
 */
export async function commandSpecs(): Promise<CommandSpec[]> {
  const out: CommandSpec[] = [];
  for (const [name, load] of Object.entries(COMMANDS)) {
    if (name.startsWith("__")) continue;
    const spec = await commandSpec(name, load, 0);
    if (spec) out.push(spec);
  }
  return out;
}
