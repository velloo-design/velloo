import type { ArgsDef, CommandMeta } from "citty";
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

/**
 * Introspect the live citty command table into a flat completion spec.
 * Internal (`__`-prefixed) and hidden commands are excluded; boolean flags that default
 * to true surface as their `--no-` form (the only form worth typing).
 */
export async function commandSpecs(): Promise<CommandSpec[]> {
  const out: CommandSpec[] = [];
  for (const [name, load] of Object.entries(COMMANDS)) {
    if (name.startsWith("__")) continue;
    let meta: CommandMeta | undefined;
    let args: ArgsDef;
    try {
      const cmd = await resolvable(load);
      meta = cmd.meta ? await resolvable(cmd.meta) : undefined;
      args = cmd.args ? await resolvable(cmd.args) : {};
    } catch {
      continue;
    }
    if (meta?.hidden) continue;
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
    out.push({ name, description: sanitize(meta?.description), flags });
  }
  return out;
}
