import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { $, DoAsync, err, ok, type Result } from "@velloo/result";
import {
  ColorsSchema,
  type Theme,
  ThemeSchema,
  type ThemeSource,
  themeNameProblem,
} from "@velloo/schema";
import { type ActivityEvent, emitActivity } from "../activity.ts";
import { type DesignFolder, themeByName } from "../design-folder.ts";
import { designSystemConfigPath } from "../design-system.ts";
import { hostAppRootFrom } from "../live/bundle-core.ts";
import { createLockMap } from "../locks.ts";
import { persistBoard, persistConfig, persistNamedTheme } from "../mutations/persist.ts";
import type { WatchEvent } from "../watcher.ts";
import { applyPreset as applyPresetImpl } from "./apply-preset.ts";
import { type CustomCssResult, setCustomCss as setCustomCssImpl } from "./custom-css.ts";
import { type DeriveResult, derivePalette } from "./derive-palette.ts";
import { invalidThemePath, type ThemeError, unknownPreset } from "./errors.ts";
import {
  type ImportThemeCssResult,
  importThemeCss as importThemeCssImpl,
  type MergeThemeOptions,
} from "./import-css.ts";
import {
  type ImportDesignMdOptions,
  type ImportDesignMdResult,
  importThemeDesignMd as importThemeDesignMdImpl,
} from "./import-design-md.ts";
import { PRESET_NAMES } from "./presets.ts";
import { type FontSpec, setFonts as setFontsImpl } from "./set-fonts.ts";
import {
  setToken as setTokenImpl,
  setTokens as setTokensImpl,
  type TokenEntry,
} from "./set-token.ts";
import { setTypeset as setTypesetImpl, type TypesetSpec } from "./set-typeset.ts";
import { matchingStartingPoint, STARTING_POINTS, startingPointTheme } from "./starting-points.ts";
import { recordThemeSource } from "./theme-source.ts";

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
): Promise<
  Result<{ theme: Theme; applied: string[]; readAs: Record<string, string> }, ThemeError>
> {
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
    if (!overwrite && ctx.folder.themes.has(name)) {
      return themeErr(`theme "${name}" already exists (pass overwrite: true to replace)`);
    }
    const problem = themeNameProblem(name, otherThemeNames(ctx, name));
    if (problem) return themeErr(`theme name "${name}" cannot be used: ${problem}`);
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
    const problem = themeNameProblem(renameTo, otherThemeNames(ctx, name));
    if (problem) return themeErr(`theme name "${renameTo}" cannot be used: ${problem}`);

    const source = ctx.folder.themes.get(name) as Theme;
    const file = (stem: string) => join(ctx.folder.root, "theme", `${stem}.json`);
    // "night" → "Night" is one file on a disk that ignores case: writing the
    // new name and deleting the old would delete what was just written.
    const sameFile = renameTo.toLowerCase() === name.toLowerCase();
    if (sameFile) await rename(file(name), file(renameTo));
    await persistNamedTheme(ctx.folder, renameTo, { ...source, name: renameTo });
    if (!sameFile) await rm(file(name), { force: true });
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

/** Every theme but `self` — the names a new or renamed theme must not collide with. */
function otherThemeNames(ctx: ThemeContext, self: string): string[] {
  return [...ctx.folder.themes.keys()].filter((known) => known !== self);
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

/**
 * Replace the palette, faces and radius with a named design system's — see
 * `starting-points.ts`. One write, so it is one undo.
 */
export async function applyStartingPoint(
  ctx: ThemeContext,
  id: string,
  themeName = "default",
): Promise<Result<Theme, ThemeError>> {
  return withThemeLock(ctx.folder, () =>
    DoAsync<Theme, ThemeError>(async function* () {
      const point = STARTING_POINTS.find((p) => p.id === id);
      if (!point) {
        return yield* $(
          err(
            unknownPreset(
              id,
              `Known starting points: ${STARTING_POINTS.map((p) => p.id).join(", ")}`,
            ),
          ),
        );
      }
      const next = yield* $(startingPointTheme(point, themeByName(ctx.folder, themeName)));
      const persisted = await persistNamedTheme(ctx.folder, themeName, ThemeSchema.parse(next));
      broadcastThemeChanged(ctx);
      emitActivity(ctx, "apply_starting_point", themeName === "default" ? {} : { themeName });
      return persisted;
    }),
  );
}

/** One theme edit: read, change in memory, validate, persist, announce. */
function editTheme(
  ctx: ThemeContext,
  themeName: string,
  verb: string,
  change: (theme: Theme) => Result<Theme, ThemeError>,
): Promise<Result<Theme, ThemeError>> {
  return withThemeLock(ctx.folder, () =>
    DoAsync<Theme, ThemeError>(async function* () {
      const next = yield* $(change(themeByName(ctx.folder, themeName)));
      const parsed = ThemeSchema.safeParse(next);
      if (!parsed.success) {
        return yield* $(err(invalidThemePath(parsed.error.issues[0]?.message ?? "invalid theme")));
      }
      const persisted = await persistNamedTheme(ctx.folder, themeName, parsed.data);
      broadcastThemeChanged(ctx);
      emitActivity(ctx, verb, themeName === "default" ? {} : { themeName });
      return persisted;
    }),
  );
}

/**
 * Set the base corner radius, and nothing else about corners. The scale is
 * replaced rather than patched: steps left over from another radius would keep
 * `rounded-sm` and `rounded-xl` where they were while the base moved.
 */
export function setRadius(
  ctx: ThemeContext,
  value: string | number,
  themeName = "default",
): Promise<Result<Theme, ThemeError>> {
  return editTheme(ctx, themeName, "set_radius", (theme) =>
    ok({
      ...theme,
      radius: {
        ...(theme.radius.full !== undefined ? { full: theme.radius.full } : {}),
        md: value,
      },
    }),
  );
}

const SEMANTIC_ROLE_NAMES: ReadonlySet<string> = new Set(
  Object.keys(ColorsSchema.shape).flatMap((slot) => [slot, `${slot}-foreground`]),
);

/**
 * Add, recolour or drop a colour role of the design's own — `success`,
 * `tertiary` — beside the semantic slots. It lives in the palette, light and
 * dark together, so it is a `--color-<name>` like any other.
 */
export function setCustomRole(
  ctx: ThemeContext,
  role: {
    name: string;
    light?: string | undefined;
    dark?: string | undefined;
    remove?: boolean | undefined;
  },
  themeName = "default",
): Promise<Result<Theme, ThemeError>> {
  return editTheme(ctx, themeName, "set_custom_role", (theme) => {
    if (SEMANTIC_ROLE_NAMES.has(role.name)) {
      return err(
        invalidThemePath(
          `"${role.name}" is already one of the theme's own roles — pick another name`,
        ),
      );
    }
    const palette = { ...theme.palette };
    const paletteDark = { ...theme.paletteDark };
    if (role.remove) {
      delete palette[role.name];
      delete paletteDark[role.name];
    } else {
      const light = role.light ?? palette[role.name];
      if (light === undefined) {
        return err(invalidThemePath(`role "${role.name}" needs a light colour`));
      }
      palette[role.name] = light;
      paletteDark[role.name] = role.dark ?? paletteDark[role.name] ?? light;
    }
    const { palette: _p, paletteDark: _d, ...rest } = theme;
    return ok({
      ...rest,
      ...(Object.keys(palette).length > 0 ? { palette } : {}),
      ...(Object.keys(paletteDark).length > 0 ? { paletteDark } : {}),
    });
  });
}

/**
 * Write a theme back whole — how the canvas undoes a visit to its
 * design-language stage. Validated at the route, since the theme comes back
 * from a client. Only a theme that exists can be put back: this restores, it
 * does not create.
 */
export async function restoreTheme(
  ctx: ThemeContext,
  theme: Theme,
  themeName = "default",
): Promise<Result<Theme, ThemeError>> {
  return withThemeLock(ctx.folder, async () => {
    if (!ctx.folder.themes.has(themeName)) return themeErr(`Unknown theme "${themeName}".`);
    const persisted = await persistNamedTheme(ctx.folder, themeName, theme);
    broadcastThemeChanged(ctx);
    emitActivity(ctx, "restore_theme", themeName === "default" ? {} : { themeName });
    return { ok: true as const, value: persisted };
  });
}

export async function derivePaletteFromColor(
  ctx: ThemeContext,
  seedColor: string,
  name?: string,
): Promise<Result<DeriveResult, ThemeError>> {
  return withThemeLock(ctx.folder, () =>
    DoAsync<DeriveResult, ThemeError>(async function* () {
      // Built on the theme it is written to, so a theme that already has its
      // own faces and corners keeps them; a name not yet in use starts from
      // the default.
      const result = yield* $(derivePalette(seedColor, themeByName(ctx.folder, name), name));
      // A named derive writes theme/<name>.json — never the default theme.
      const persisted = await persistNamedTheme(ctx.folder, name ?? "default", result.theme);
      broadcastThemeChanged(ctx);
      emitActivity(ctx, "derive_palette_from_color", name ? { themeName: name } : {});
      return { ...result, theme: persisted };
    }),
  );
}

/**
 * Say where the default theme now comes from, so a later session checks it
 * against the right thing. Unchanged ⇒ nothing written.
 */
async function recordSource(
  ctx: ThemeContext,
  kind: ThemeSource["kind"],
  files: readonly string[],
): Promise<void> {
  let appRoot: string;
  try {
    appRoot = hostAppRootFrom(ctx.folder.root, ctx.folder.config.hostApp);
  } catch {
    return;
  }
  const themeSource = recordThemeSource(appRoot, { kind, files });
  if (JSON.stringify(ctx.folder.config.themeSource) === JSON.stringify(themeSource)) return;
  await persistConfig(ctx.folder, { ...ctx.folder.config, themeSource });
  ctx.broadcast({ type: "config-changed" });
}

export async function importThemeCss(
  ctx: ThemeContext,
  css: string,
  opts: MergeThemeOptions & {
    themeName?: string;
    apply?: boolean;
    /**
     * The files the CSS was read from, absolute, the stylesheet first — given
     * the merge, whose traced fonts name the loader modules it read. When
     * present, an applied import into the default theme records them as where
     * the theme came from (`config.themeSource`); empty for pasted text.
     */
    sourceFiles?: (merged: ImportThemeCssResult) => readonly string[];
  } = {},
): Promise<Result<ImportThemeCssResult, ThemeError>> {
  return withThemeLock(ctx.folder, async () => {
    const r = await importThemeCssImpl(ctx.folder, css, opts);
    if (r.ok && r.value.applied) {
      if (opts.sourceFiles && (opts.themeName ?? "default") === "default") {
        await recordSource(ctx, "stylesheet", opts.sourceFiles(r.value));
      }
      broadcastThemeChanged(ctx);
      emitActivity(ctx, "import_theme", opts.themeName ? { themeName: opts.themeName } : {});
    }
    return r;
  });
}

/**
 * Code-to-design from a Google Labs `DESIGN.md` instead of a stylesheet — the
 * same merge contract as {@link importThemeCss}: dry-run by default, slots the
 * file does not name keep their values.
 */
export async function importThemeDesignMd(
  ctx: ThemeContext,
  source: string,
  opts: ImportDesignMdOptions = {},
): Promise<Result<ImportDesignMdResult, ThemeError>> {
  return withThemeLock(ctx.folder, async () => {
    const r = await importThemeDesignMdImpl(ctx.folder, source, opts);
    if (r.ok && r.value.applied) {
      // Record the file, do not copy it. An import is the folder saying which
      // design system it follows; the document stays where the repo keeps it
      // and is read fresh every time, so editing it is all a user has to do.
      // Only the light palette of the default theme names it: a dark file or
      // a secondary theme layered on top must not take over what is followed.
      const followsIt =
        opts.sourcePath !== undefined &&
        r.value.mode === "light" &&
        (opts.themeName ?? "default") === "default";
      if (followsIt) {
        const path = designSystemConfigPath(ctx.folder, opts.sourcePath as string);
        if (path === null) {
          r.value.warnings.push(
            `${opts.sourcePath} is outside the app root, so the design cannot be pointed at it — a design follows only files inside its app. Move the DESIGN.md into the app, or keep it where the design finds one by convention.`,
          );
        } else if (ctx.folder.config.designSystem?.path !== path) {
          await persistConfig(ctx.folder, { ...ctx.folder.config, designSystem: { path } });
          ctx.broadcast({ type: "config-changed" });
        }
        await recordSource(ctx, "design-md", [opts.sourcePath as string]);
      }
      broadcastThemeChanged(ctx);
      emitActivity(ctx, "import_theme", opts.themeName ? { themeName: opts.themeName } : {});
    }
    return r;
  });
}

export { scoreThemeContrast, scoreThemeContrastBoth } from "./contrast.ts";
export type { DeriveResult } from "./derive-palette.ts";
export type { ThemeError } from "./errors.ts";
export type { ImportDesignMdOptions, ImportDesignMdResult, ImportThemeCssResult, TokenEntry };
export { matchingStartingPoint, PRESET_NAMES, STARTING_POINTS };
