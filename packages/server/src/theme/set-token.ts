import { err, ok, type Result, tryCatchAsync } from "@velloo/result";
import { type Theme, ThemeSchema } from "@velloo/schema";
import { type DesignFolder, themeByName } from "../design-folder.ts";
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
): Promise<Result<{ theme: Theme; applied: string[] }, ThemeError>> {
  // Deep-clone the current theme so we never mutate the cached object.
  let working = JSON.parse(JSON.stringify(themeByName(folder, themeName))) as Theme;
  const applied: string[] = [];
  const failed: { path: string; reason: string }[] = [];

  for (const { path, value } of entries) {
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
        reason: `Setting ${path} to ${JSON.stringify(value)} produced an invalid theme at "${where}": ${issue?.message ?? "schema mismatch"}`,
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
        reason: `"${path}" is not a token this theme defines, so the write was dropped. Check the slot name (e.g. "colors.primary.DEFAULT", "colorsDark.background"), or use "palette.<name>" for a raw brand value.`,
      });
      continue;
    }
    working = parsed.data;
    applied.push(path);
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
  return persisted.ok ? ok({ theme: persisted.value, applied }) : persisted;
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
