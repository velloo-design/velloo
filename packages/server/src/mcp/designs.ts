import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { type DesignEntry, type DesignPickReason, type DesignSet, designsFor } from "../designs.ts";

/**
 * What an agent session knows about the other designs in its checkout. One
 * daemon serves one design, so a session is bound to the design it was opened
 * on; this is how it learns the checkout has others, and — when the stdio
 * proxy is in between — how it moves to one.
 *
 * Everything here is conditional: a checkout with a single design gets no
 * extra instructions and no extra operations, so the common case pays nothing.
 */

/** The `_meta` key a `switch_design` result carries for the stdio proxy to act on. */
export const SWITCH_DESIGN_META = "velloo/switchDesign";

export interface SwitchDesignDirective {
  name: string;
  /** Absolute design folder the proxy should rebind to. */
  root: string;
}

/** Per-session facts `velloo mcp` passes on the endpoint URL. */
export interface McpSessionOptions {
  /** True when a stdio proxy sits in front and can rebind the session to another daemon. */
  switchable: boolean;
  /** How the design was chosen, when no name was given. */
  pick: DesignPickReason | undefined;
}

const PICK_REASONS: readonly DesignPickReason[] = ["cwd", "only", "default", "arbitrary"];

export function parseMcpSessionUrl(url: string | undefined): McpSessionOptions {
  const params = new URL(url ?? "/mcp", "http://velloo.local").searchParams;
  const pick = params.get("pick");
  return {
    switchable: params.get("switch") === "1",
    pick: PICK_REASONS.find((reason) => reason === pick),
  };
}

export function withMcpSessionUrl(url: string, session: Partial<McpSessionOptions>): string {
  const parsed = new URL(url);
  if (session.switchable) parsed.searchParams.set("switch", "1");
  else parsed.searchParams.delete("switch");
  if (session.pick) parsed.searchParams.set("pick", session.pick);
  else parsed.searchParams.delete("pick");
  return parsed.toString();
}

export interface SessionDesigns {
  /** The design this session is bound to. */
  current: string;
  /** Every design the session could work on, current included, sorted by name. */
  names: string[];
  switchable: boolean;
  pick: DesignPickReason | undefined;
}

function realOr(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

/** The designs an agent may be pointed at: present, inside their repo, and uniquely named. */
function usableDesigns(set: DesignSet | null): DesignEntry[] {
  return (set?.designs ?? []).filter(
    (d) => d.exists && !d.outsideRepo && set?.byName.get(d.name) === d,
  );
}

/**
 * The session's view of its checkout's designs, or null when there is nothing
 * else to know — a single design, or one outside any checkout.
 */
export async function sessionDesigns(
  root: string,
  current: string,
  options: McpSessionOptions,
): Promise<SessionDesigns | null> {
  const set = await designsFor(root).catch(() => null);
  const here = realOr(root);
  const others = usableDesigns(set).filter((d) => realOr(d.root) !== here);
  if (others.length === 0) return null;
  const names = [...new Set([current, ...others.map((d) => d.name)])].sort();
  return { current, names, switchable: options.switchable, pick: options.pick };
}

/** The instruction lines for a multi-design session. */
export function designsInstruction(designs: SessionDesigns): string[] {
  const { current, names } = designs;
  const list = names.map((n) => (n === current ? `\`${n}\` (this session)` : `\`${n}\``));
  const move = designs.switchable
    ? "`switch_design` moves to another"
    : "to work on another, the user reconnects with `velloo mcp <name>`";
  const lines = [
    `**Design: \`${current}\`** — one of ${names.length} here: ${list.join(", ")}. Operations target \`${current}\`; ${move}. Tell the user when you switch.`,
  ];
  if (designs.pick === "arbitrary") {
    lines.unshift(
      `**No design was specified, so this session opened \`${current}\`.** Confirm which design the user means before changing anything.`,
    );
  }
  return lines;
}

function countJson(dir: string, skipSuffix: string): number {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(skipSuffix)).length;
  } catch {
    return 0;
  }
}

function defaultLibraryOf(folder: string): string | undefined {
  try {
    const config = JSON.parse(readFileSync(join(folder, ".design", "config.json"), "utf8")) as {
      defaultLibrary?: unknown;
      libraries?: Record<string, { id?: unknown }>;
    };
    const key = typeof config.defaultLibrary === "string" ? config.defaultLibrary : undefined;
    const id = key ? config.libraries?.[key]?.id : undefined;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

export interface DesignListing {
  name: string;
  /** Repository-relative for a repository design; absolute for a local one. */
  path: string;
  current: boolean;
  /** Kept outside the repository, on this machine only. */
  local: boolean;
  library: string | undefined;
  boards: number;
  screens: number;
}

/** A fresh listing of the checkout's designs, read at call time. */
export async function listDesigns(root: string): Promise<DesignListing[]> {
  const set = await designsFor(root);
  const here = realOr(root);
  return usableDesigns(set).map((d) => ({
    name: d.name,
    path:
      d.local || !set?.repo ? d.root : relative(set.repo.dir, d.root).split(sep).join("/") || ".",
    current: realOr(d.root) === here,
    local: d.local !== null,
    library: defaultLibraryOf(d.root),
    boards: countJson(join(d.root, "boards"), ".notes.json"),
    screens: countJson(join(d.root, "screens"), ".annotations.json"),
  }));
}

/** Resolve a `switch_design` target, re-reading the checkout so a design added mid-session counts. */
export async function switchTarget(
  root: string,
  name: string,
): Promise<
  { ok: true; directive: SwitchDesignDirective } | { ok: false; error: Record<string, unknown> }
> {
  const set = await designsFor(root);
  const target = usableDesigns(set).find((d) => d.name === name);
  if (!target) {
    return {
      ok: false,
      error: {
        kind: "UnknownDesign",
        name,
        designs: usableDesigns(set).map((d) => d.name),
      },
    };
  }
  return { ok: true, directive: { name: target.name, root: target.root } };
}
