import { rm } from "node:fs/promises";
import { join } from "node:path";
import { $, DoAsync, type Result } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import { type ActivityEvent, emitActivity } from "../activity.ts";
import { type DesignFolder, themeByName } from "../design-folder.ts";
import { createLockMap } from "../locks.ts";
import { persistBoard, persistNamedTheme } from "../mutations/persist.ts";
import type { WatchEvent } from "../watcher.ts";
import { applyPreset as applyPresetImpl } from "./apply-preset.ts";
import { type CustomCssResult, setCustomCss as setCustomCssImpl } from "./custom-css.ts";
import { type DeriveResult, derivePalette } from "./derive-palette.ts";
import type { ThemeError } from "./errors.ts";
import { type ImportThemeCssResult, importThemeCss as importThemeCssImpl } from "./import-css.ts";
import { PRESET_NAMES, PRESETS } from "./presets.ts";
import { type FontSpec, setFonts as setFontsImpl } from "./set-fonts.ts";
import {
  setToken as setTokenImpl,
  setTokens as setTokensImpl,
  type TokenEntry,
} from "./set-token.ts";
import { setTypeset as setTypesetImpl, type TypesetSpec } from "./set-typeset.ts";

export interface ThemeContext {
  folder: DesignFolder;
  /** WatchEvents drive refresh; activity events are presentation metadata. */
  broadcast: (e: WatchEvent | ActivityEvent) => void;
}

const themeLocks = createLockMap();

/**
 * Serialize theme writes per design folder — keyed by `folder.root` so two
 * folders served by one daemon never contend, with drained chains evicted.
 * Exported for the lock-isolation tests; mutation code goes through the
 * theme operations below rather than taking this directly.
 */
export function withThemeLock<T>(
  folder: Pick<DesignFolder, "root">,
  fn: () => Promise<T>,
): Promise<T> {
  return themeLocks.run(folder.root, fn);
}

function broadcastThemeChanged(ctx: ThemeContext): void {
  ctx.broadcast({ type: "theme-changed" });
}

export async function setToken(
  ctx: ThemeContext,
  path: string,
  value: string | number,
  themeName?: string,
): Promise<Result<Theme, ThemeError>> {
  return withThemeLock(ctx.folder, async () => {
    const r = await setTokenImpl(ctx.folder, path, value, themeName);
    if (r.ok) {
      broadcastThemeChanged(ctx);
      emitActivity(ctx, "set_token", { token: path, ...(themeName ? { themeName } : {}) });
    }
    return r;
  });
}

/**
 * Bulk token write: all entries under ONE lock acquisition, one validation
 * pass, one persist, one broadcast. All-or-nothing — see {@link setTokensImpl}
 * for the `BulkTokensInvalid` partial report on failure.
 */
export async function setTokens(
  ctx: ThemeContext,
  entries: TokenEntry[],
  themeName?: string,
): Promise<Result<{ theme: Theme; applied: string[] }, ThemeError>> {
  return withThemeLock(ctx.folder, async () => {
    const r = await setTokensImpl(ctx.folder, entries, themeName);
    if (r.ok) {
      broadcastThemeChanged(ctx);
      emitActivity(ctx, "set_tokens", {
        ...(entries[0] ? { token: entries[0].path } : {}),
        ...(themeName ? { themeName } : {}),
      });
    }
    return r;
  });
}

export async function setFonts(
  ctx: ThemeContext,
  fonts: FontSpec[],
  themeName?: string,
): Promise<Result<Theme, ThemeError>> {
  return withThemeLock(ctx.folder, async () => {
    const r = await setFontsImpl(ctx.folder, fonts, themeName);
    if (r.ok) {
      broadcastThemeChanged(ctx);
      emitActivity(ctx, "set_fonts", themeName ? { themeName } : {});
    }
    return r;
  });
}

/**
 * Declare or retune typesets. A `theme-changed` broadcast invalidates the JIT
 * and re-renders every frame, so a rhythm change lands live.
 */
export async function setTypeset(
  ctx: ThemeContext,
  typesets: TypesetSpec[],
  themeName?: string,
): Promise<Result<Theme, ThemeError>> {
  return withThemeLock(ctx.folder, async () => {
    const r = await setTypesetImpl(ctx.folder, typesets, themeName);
    if (r.ok) {
      broadcastThemeChanged(ctx);
      emitActivity(ctx, "set_typeset", themeName ? { themeName } : {});
    }
    return r;
  });
}

/** Create theme/<name>.json by cloning another theme (default if omitted). */
export async function addTheme(
  ctx: ThemeContext,
  name: string,
  from?: string,
  overwrite = false,
): Promise<Result<{ name: string; theme: Theme }, ThemeError>> {
  return withThemeLock(ctx.folder, async () => {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || name === "default") {
      return {
        ok: false as const,
        error: {
          kind: "InvalidThemePath" as const,
          reason: `theme name "${name}" must be lowercase kebab (and not "default")`,
        },
      };
    }
    if (!overwrite && ctx.folder.themes.has(name)) {
      return {
        ok: false as const,
        error: {
          kind: "InvalidThemePath" as const,
          reason: `theme "${name}" already exists (pass overwrite: true to replace)`,
        },
      };
    }
    const source = themeByName(ctx.folder, from);
    const cloned: Theme = JSON.parse(JSON.stringify({ ...source, name }));
    const persisted = await persistNamedTheme(ctx.folder, name, cloned);
    broadcastThemeChanged(ctx);
    emitActivity(ctx, "add_theme", { themeName: name });
    return { ok: true as const, value: { name, theme: persisted } };
  });
}

/**
 * Rename a named theme, repointing every board that pinned it. A rename that
 * left boards pointing at a gone name would silently fall them back to the
 * default palette, so the two moves are one operation.
 */
export async function renameTheme(
  ctx: ThemeContext,
  name: string,
  renameTo: string,
): Promise<Result<{ name: string; repointedBoards: string[] }, ThemeError>> {
  return withThemeLock(ctx.folder, async () => {
    const guard = namedThemeGuard(ctx, name, "rename");
    if (guard) return guard;
    if (!/^[a-z][a-z0-9-]*$/.test(renameTo) || renameTo === "default") {
      return themeErr(`theme name "${renameTo}" must be lowercase kebab (and not "default")`);
    }
    if (ctx.folder.themes.has(renameTo)) return themeErr(`theme "${renameTo}" already exists`);

    const source = ctx.folder.themes.get(name) as Theme;
    await persistNamedTheme(ctx.folder, renameTo, { ...source, name: renameTo });
    await rm(join(ctx.folder.root, "theme", `${name}.json`), { force: true });
    ctx.folder.themes.delete(name);

    const repointedBoards: string[] = [];
    for (const board of ctx.folder.boards.values()) {
      if (board.theme !== name) continue;
      await persistBoard(ctx.folder, board.id, { ...board, theme: renameTo });
      repointedBoards.push(board.id);
    }
    broadcastThemeChanged(ctx);
    emitActivity(ctx, "rename_theme", { themeName: renameTo });
    return { ok: true as const, value: { name: renameTo, repointedBoards } };
  });
}

/**
 * Delete a named theme. Refuses while a board still pins it — unpinning those
 * boards silently would change how their frames render, so the caller decides.
 */
export async function removeTheme(
  ctx: ThemeContext,
  name: string,
): Promise<Result<{ removedTheme: string }, ThemeError>> {
  return withThemeLock(ctx.folder, async () => {
    const guard = namedThemeGuard(ctx, name, "remove");
    if (guard) return guard;
    const pinned = [...ctx.folder.boards.values()].filter((b) => b.theme === name).map((b) => b.id);
    if (pinned.length > 0) {
      return themeErr(
        `theme "${name}" is pinned by ${pinned.join(", ")} — repoint or unpin those boards first (update_board { patch: { theme: null } })`,
      );
    }
    await rm(join(ctx.folder.root, "theme", `${name}.json`), { force: true });
    ctx.folder.themes.delete(name);
    broadcastThemeChanged(ctx);
    emitActivity(ctx, "remove_theme", { themeName: name });
    return { ok: true as const, value: { removedTheme: name } };
  });
}

const themeErr = (reason: string) => ({
  ok: false as const,
  error: { kind: "InvalidThemePath" as const, reason },
});

/** Both edits refuse the same two cases: the default theme, and an unknown name. */
function namedThemeGuard(ctx: ThemeContext, name: string, verb: string) {
  if (name === "default") return themeErr(`cannot ${verb} the default theme`);
  if (!ctx.folder.themes.has(name)) return themeErr(`theme "${name}" does not exist`);
  return null;
}

export function listThemes(ctx: ThemeContext): {
  themes: { name: string; usedByBoards: string[] }[];
} {
  const themes = [...ctx.folder.themes.keys()].sort().map((name) => ({
    name,
    usedByBoards: [...ctx.folder.boards.values()]
      .filter((b) => (b.theme ?? "default") === name)
      .map((b) => b.id),
  }));
  return { themes };
}

export async function setCustomCss(
  ctx: ThemeContext,
  css: string,
): Promise<Result<CustomCssResult, ThemeError>> {
  return withThemeLock(ctx.folder, async () => {
    const r = await setCustomCssImpl(ctx.folder, css);
    if (r.ok) {
      broadcastThemeChanged(ctx);
      emitActivity(ctx, "custom_css", {});
    }
    return r;
  });
}

export type { CustomCssResult, FontSpec, TypesetSpec };

export async function applyPreset(
  ctx: ThemeContext,
  presetName: string,
  themeName?: string,
): Promise<Result<Theme, ThemeError>> {
  return withThemeLock(ctx.folder, async () => {
    const r = await applyPresetImpl(ctx.folder, presetName, themeName);
    if (r.ok) {
      broadcastThemeChanged(ctx);
      emitActivity(ctx, "apply_preset", themeName ? { themeName } : {});
    }
    return r;
  });
}

export async function derivePaletteFromColor(
  ctx: ThemeContext,
  seedColor: string,
  name?: string,
): Promise<Result<DeriveResult, ThemeError>> {
  return withThemeLock(ctx.folder, () =>
    DoAsync<DeriveResult, ThemeError>(async function* () {
      const result = yield* $(derivePalette(seedColor, ctx.folder.theme, name));
      // A named derive writes theme/<name>.json — never the default theme.
      const persisted = await persistNamedTheme(ctx.folder, name ?? "default", result.theme);
      broadcastThemeChanged(ctx);
      emitActivity(ctx, "derive_palette_from_color", name ? { themeName: name } : {});
      return { ...result, theme: persisted };
    }),
  );
}

export async function importThemeCss(
  ctx: ThemeContext,
  css: string,
  opts: { themeName?: string; apply?: boolean; tailwindConfig?: string } = {},
): Promise<Result<ImportThemeCssResult, ThemeError>> {
  return withThemeLock(ctx.folder, async () => {
    const r = await importThemeCssImpl(ctx.folder, css, opts);
    if (r.ok && r.value.applied) {
      broadcastThemeChanged(ctx);
      emitActivity(ctx, "import_theme", opts.themeName ? { themeName: opts.themeName } : {});
    }
    return r;
  });
}

export { scoreThemeContrast, scoreThemeContrastBoth } from "./contrast.ts";
export type { DeriveResult } from "./derive-palette.ts";
export type { ThemeError } from "./errors.ts";
export type { ImportThemeCssResult, TokenEntry };
export { PRESET_NAMES, PRESETS };
