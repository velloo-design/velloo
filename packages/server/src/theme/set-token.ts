import { SEMANTIC_SLOTS } from "@velloo/codegen";
import { err, ok, type Result, tryCatchAsync } from "@velloo/result";
import { type Theme, ThemeSchema } from "@velloo/schema";
import type { z } from "zod";
import { type DesignFolder, themeByName } from "../design-folder.ts";
import { levenshtein, nearestRefs } from "../mutations/errors.ts";
import { persistNamedTheme } from "../mutations/persist.ts";
import { invalidThemePath, type ThemeError } from "./errors.ts";

export interface TokenEntry {
  path: string;
  value: string | number;
}

/**
 * Apply one dot-path write to a plain theme object in place, creating
 * intermediate objects as needed. Returns a failure reason, or null.
 */
function applyPath(
  target: Record<string, unknown>,
  path: string,
  value: string | number,
): string | null {
  if (!path) return "path is required";
  const segments = path.split(".");
  if (
    segments.some((s) => s === "" || s === "__proto__" || s === "constructor" || s === "prototype")
  ) {
    return `bad path: ${JSON.stringify(path)}`;
  }
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const k = segments[i] as string;
    // Unreachable after the check above (which refuses before anything is
    // written); repeated on `k` so the guard sits on the key being written.
    if (k === "__proto__" || k === "constructor" || k === "prototype") {
      return `bad path: ${JSON.stringify(path)}`;
    }
    const existing = cursor[k];
    if (existing === undefined || typeof existing !== "object" || existing === null) {
      cursor[k] = {};
    }
    cursor = cursor[k] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1] as string] = value;
  return null;
}

/**
 * Read a dot-path out of a value; `undefined` when any segment is missing.
 * Used to confirm a write survived validation — see {@link setTokens}.
 */
function valueAt(source: unknown, path: string): unknown {
  let cursor: unknown = source;
  for (const segment of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Zod reports a rejected record key as a bare "Invalid key in record" and keeps
 * the key schema's own message — the one that names the allowed form — nested
 * under it. Surface that, plus the kebab-case spelling when the key was only
 * camelCased (`palette.primarySoft` → `palette.primary-soft`).
 */
function issueMessage(issue: z.core.$ZodIssue, path: string): string {
  if (issue.code !== "invalid_key") return issue.message;
  const nested = issue.issues[0]?.message ?? issue.message;
  const segments = path.split(".");
  const key = segments.at(-1) ?? "";
  const kebab = key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
  if (kebab === key || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(kebab)) return nested;
  return `${nested}. Did you mean "${[...segments.slice(0, -1), kebab].join(".")}"?`;
}

/**
 * `colors.card-foreground` is the token's name everywhere else an agent meets
 * it — the CSS variable (`--card-foreground`), the utility
 * (`text-card-foreground`) — while the theme files nest it as
 * `colors.card.foreground`. Where the hyphenated spelling names no token of
 * its own and the nested one exists, it is read as the nested one.
 */
/** The semantic slot `name` is probably a misspelling of, or null. */
function nearSlot(name: string): string | null {
  const [nearest] = nearestRefs(name, [...SEMANTIC_SLOTS], 1);
  // One edit from a slot — two in a long name — is a typo; further off is
  // another word (`chart` is not `card`).
  if (nearest === undefined || name.length < 5) return null;
  return levenshtein(name, nearest) <= (name.length >= 7 ? 2 : 1) ? nearest : null;
}

function slotPath(theme: Theme, path: string): string {
  if (valueAt(theme, path) !== undefined) return path;
  const pair = /^(colors|colorsDark)\.([a-z][a-z0-9-]*)-foreground$/.exec(path);
  if (pair) {
    const slot = `${pair[1]}.${pair[2]}`;
    // `colorsDark` holds only the slots it overrides; the light side says what shape one has.
    const held = valueAt(theme, slot) ?? valueAt(theme, `colors.${pair[2]}`);
    if (typeof held === "object" && held !== null) return `${slot}.foreground`;
  }
  // `colors.background.DEFAULT`: a slot that is one colour, written as the
  // pair its neighbours are.
  const flat = /^((?:colors|colorsDark)\.[a-z][a-z0-9-]*)\.DEFAULT$/.exec(path);
  if (flat && typeof valueAt(theme, flat[1] as string) === "string") return flat[1] as string;
  // `colors.success`, `colors.error`: a colour with a name the semantic set
  // doesn't have (every other design system's palette does). It is a brand
  // colour, which is what `palette` holds.
  // …written flat or as the pair a semantic slot would be (`.DEFAULT`, `.foreground`).
  const named =
    /^(colors|colorsDark)\.([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:\.(DEFAULT|foreground))?$/.exec(path);
  // A name one slip away from a semantic slot (`primry`) is that slot
  // misspelled, and has to be heard about rather than become a new colour.
  if (named && !SEMANTIC_SLOTS.has(named[2] as string) && nearSlot(named[2] as string) === null) {
    const name = named[3] === "foreground" ? `${named[2]}-foreground` : named[2];
    return `${named[1] === "colors" ? "palette" : "paletteDark"}.${name}`;
  }
  return path;
}

/** ` Did you mean "colors.primary.DEFAULT"?` for a path whose slot is one slip from a real one. */
function typoOf(path: string): string {
  const [group, name, ...rest] = path.split(".");
  const slot = name === undefined ? null : nearSlot(name);
  return slot === null ? "" : ` Did you mean "${[group, slot, ...rest].join(".")}"?`;
}

/**
 * Apply a batch of token writes: every entry lands on ONE in-memory copy,
 * validated entry-by-entry (so a failure names the offending path), then the
 * result is persisted ONCE. All-or-nothing: any bad entry means nothing is
 * written — the `BulkTokensInvalid` error reports which entries validated
 * cleanly (`applied`) and which failed and why (`failed`).
 */
export async function setTokens(
  folder: DesignFolder,
  entries: TokenEntry[],
  themeName = "default",
): Promise<
  Result<{ theme: Theme; applied: string[]; readAs: Record<string, string> }, ThemeError>
> {
  // Deep-clone the current theme so we never mutate the cached object.
  let working = JSON.parse(JSON.stringify(themeByName(folder, themeName))) as Theme;
  const applied: string[] = [];
  const readAs: Record<string, string> = {};
  const failed: { path: string; reason: string }[] = [];

  for (const { path: written, value } of entries) {
    const path = slotPath(working, written);
    // Each entry lands on its own candidate so a bad one is discarded without
    // undoing earlier valid entries (and the report can cover ALL failures).
    const candidate = JSON.parse(JSON.stringify(working)) as Record<string, unknown>;
    const pathError = applyPath(candidate, path, value);
    if (pathError !== null) {
      failed.push({ path, reason: pathError });
      continue;
    }
    const parsed = ThemeSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.join(".") || path;
      failed.push({
        path,
        reason: `Setting ${path} to ${JSON.stringify(value)} produced an invalid theme at "${where}": ${issue ? issueMessage(issue, path) : "schema mismatch"}`,
      });
      continue;
    }
    // A closed `z.object` STRIPS unknown keys instead of rejecting them, so a
    // misspelled slot parses cleanly and then isn't there. Reporting that as
    // applied is the worst outcome: the agent is told the token landed while
    // nothing changed on disk or in memory.
    if (valueAt(parsed.data, path) === undefined) {
      failed.push({
        path,
        reason: `"${path}" is not a token this theme defines, so the write was dropped.${typoOf(path)} Check the slot name (e.g. "colors.primary.DEFAULT", "colorsDark.background"), or use "palette.<name>" for a raw brand value.`,
      });
      continue;
    }
    working = parsed.data;
    applied.push(path);
    if (path !== written) readAs[written] = path;
  }

  if (failed.length > 0) {
    return err({ kind: "BulkTokensInvalid", applied, failed });
  }

  const finalTheme = working;
  // A colour picker drags: many writes to one token should be one undo step,
  // while moving to the next token opens a new one.
  const coalesceKey = `token:${applied.join(",")}`;
  const persisted = await tryCatchAsync(
    () => persistNamedTheme(folder, themeName, finalTheme, coalesceKey),
    (e) => invalidThemePath(`Persisting theme "${themeName}" failed: ${(e as Error).message}`),
  );
  return persisted.ok ? ok({ theme: persisted.value, applied, readAs }) : persisted;
}

/** Apply a single token at a dot-path — the one-entry case of {@link setTokens}. */
export async function setToken(
  folder: DesignFolder,
  path: string,
  value: string | number,
  themeName = "default",
): Promise<Result<Theme, ThemeError>> {
  const r = await setTokens(folder, [{ path, value }], themeName);
  if (r.ok) return ok(r.value.theme);
  if (r.error.kind === "BulkTokensInvalid") {
    return err(invalidThemePath(r.error.failed[0]?.reason ?? "invalid token"));
  }
  return r;
}
