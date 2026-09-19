import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { parseLiteral } from "./literal.ts";
import { blankComments, scanModule } from "./source-scan.ts";
import { findFiles } from "./walk.ts";

/**
 * Named preview states from Storybook stories (CSF): a story's `args` merged
 * over its meta's `args`, normalized to static JSON. Stories are read, never
 * run — an `args` value that isn't a literal (a handler, a fixture built in
 * code) is dropped and the state says so.
 */

export interface PreviewState {
  name: string;
  props: Record<string, unknown>;
  source: "story" | "usage" | "manifest";
  /** Host-relative location it came from. */
  at?: string | undefined;
  /** Arg names whose values were code, not data. */
  dropped?: string[] | undefined;
}

export interface StoryStates {
  /**
   * `local#Export` for the app's own component, `<package>#Export` for a
   * package's. A story imports its component straight from the file, while
   * the app may reach it through a barrel, so a local one is matched by name.
   */
  key: string;
  states: PreviewState[];
}

const MAX_STORY_FILES = 400;

export async function collectStoryStates(hostRoot: string): Promise<StoryStates[]> {
  const out: StoryStates[] = [];
  const files = await findFiles(
    hostRoot,
    (name) => /\.stories\.[jt]sx?$/.test(name),
    MAX_STORY_FILES,
  );
  for (const file of files) {
    try {
      const parsed = storiesFromSource(readFileSync(file, "utf8"), file, hostRoot);
      if (parsed) out.push(parsed);
    } catch {
      // A story file we can't read contributes no states.
    }
  }
  return out;
}

function storiesFromSource(source: string, file: string, hostRoot: string): StoryStates | null {
  const code = blankComments(source);
  const scan = scanModule(source);
  const at = relative(hostRoot, file).split(sep).join("/");
  const metaBody = objectAfter(code, /export\s+default\s*\{/) ?? metaVariable(code);
  if (!metaBody) return null;
  const component = /\bcomponent\s*:\s*([A-Z][\w$]*)/.exec(metaBody)?.[1];
  if (!component) return null;
  const binding = scan.imports
    .flatMap((decl) => decl.bindings.map((b) => ({ ...b, specifier: decl.specifier })))
    .find((b) => b.local === component);
  if (!binding) return null;
  const local = binding.specifier.startsWith(".") || binding.specifier.startsWith("@/");
  // A default export is known by the name it's imported under, as in the catalog.
  const exportName =
    binding.imported === "*" || binding.imported === "default" ? component : binding.imported;
  const metaArgs = argsOf(metaBody);

  const states: PreviewState[] = [];
  for (const match of code.matchAll(/export\s+const\s+([A-Z][\w$]*)\s*(?::[^=]+)?=\s*\{/g)) {
    const body = objectAt(code, (match.index ?? 0) + match[0].length - 1);
    if (body === null) continue;
    const own = argsOf(body);
    states.push({
      name: humanize(match[1] ?? "Story"),
      props: { ...metaArgs.props, ...own.props },
      source: "story",
      at,
      ...(own.dropped.length + metaArgs.dropped.length > 0
        ? { dropped: [...metaArgs.dropped, ...own.dropped] }
        : {}),
    });
  }
  for (const match of code.matchAll(/([A-Z][\w$]*)\.args\s*=\s*\{/g)) {
    const body = objectAt(code, (match.index ?? 0) + match[0].length - 1);
    const parsed = body === null ? null : parseLiteral(body);
    if (!parsed?.ok) continue;
    states.push({
      name: humanize(match[1] ?? "Story"),
      props: { ...metaArgs.props, ...(parsed.value as Record<string, unknown>) },
      source: "story",
      at,
    });
  }
  return states.length > 0
    ? { key: `${local ? "local" : binding.specifier}#${exportName}`, states }
    : null;
}

/** `args: { … }` inside an object body, split into literal data and dropped keys. */
function argsOf(body: string): { props: Record<string, unknown>; dropped: string[] } {
  const args = objectAfter(body, /\bargs\s*:\s*\{/);
  if (!args) return { props: {}, dropped: [] };
  const whole = parseLiteral(args);
  if (whole.ok) return { props: whole.value as Record<string, unknown>, dropped: [] };
  // Keep what is data, entry by entry; name what isn't.
  const props: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const entry of topLevelEntries(args.slice(1, -1))) {
    const colon = entry.indexOf(":");
    const key = entry
      .slice(0, colon)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (colon === -1 || !key) continue;
    const value = parseLiteral(entry.slice(colon + 1).trim());
    if (value.ok) props[key] = value.value;
    else dropped.push(key);
  }
  return { props, dropped };
}

function metaVariable(code: string): string | null {
  const name = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/.exec(code)?.[1];
  if (!name) return null;
  return objectAfter(code, new RegExp(`(?:const|let)\\s+${name}\\s*(?::[^=]+)?=\\s*\\{`));
}

function objectAfter(code: string, pattern: RegExp): string | null {
  const match = pattern.exec(code);
  if (!match) return null;
  return objectAt(code, (match.index ?? 0) + match[0].length - 1);
}

function objectAt(code: string, open: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return code.slice(open, i + 1);
  }
  return null;
}

function topLevelEntries(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] ?? "";
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "," && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

function humanize(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}
