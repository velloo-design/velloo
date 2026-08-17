import { $, DoAsync, type Result } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import { type DesignFolder, themeByName } from "../design-folder.ts";
import { persistNamedTheme, persistTheme } from "../mutations/persist.ts";
import type { WatchEvent } from "../watcher.ts";
import { applyPreset as applyPresetImpl } from "./apply-preset.ts";
import {
  type CustomCssResult,
  getCustomCss as getCustomCssImpl,
  setCustomCss as setCustomCssImpl,
} from "./custom-css.ts";
import { type DeriveResult, derivePalette } from "./derive-palette.ts";
import type { ThemeError } from "./errors.ts";
import { type MatchImageResult, matchImage as matchImageImpl } from "./match-image.ts";
import {
  type MatchVibeOpts,
  type MatchVibeResult,
  matchVibe as matchVibeImpl,
} from "./match-vibe.ts";
import { PRESET_NAMES, PRESETS } from "./presets.ts";
import { type FontSpec, setFonts as setFontsImpl } from "./set-fonts.ts";
import { setToken as setTokenImpl } from "./set-token.ts";

export interface ThemeContext {
  folder: DesignFolder;
  broadcast: (e: WatchEvent) => void;
}

let pending: Promise<unknown> = Promise.resolve();

/** Serialize theme writes against one another (a single theme per folder). */
function withThemeLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = pending.then(fn, fn);
  pending = next.catch(() => undefined);
  return next;
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
  return withThemeLock(async () => {
    const r = await setTokenImpl(ctx.folder, path, value, themeName);
    if (r.ok) broadcastThemeChanged(ctx);
    return r;
  });
}

export async function setFonts(
  ctx: ThemeContext,
  fonts: FontSpec[],
  themeName?: string,
): Promise<Result<Theme, ThemeError>> {
  return withThemeLock(async () => {
    const r = await setFontsImpl(ctx.folder, fonts, themeName);
    if (r.ok) broadcastThemeChanged(ctx);
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
  return withThemeLock(async () => {
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
    return { ok: true as const, value: { name, theme: persisted } };
  });
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
  return withThemeLock(async () => {
    const r = await setCustomCssImpl(ctx.folder, css);
    if (r.ok) broadcastThemeChanged(ctx);
    return r;
  });
}

export function getCustomCss(ctx: ThemeContext): CustomCssResult {
  return getCustomCssImpl(ctx.folder);
}

export type { CustomCssResult, FontSpec };

export async function applyPreset(
  ctx: ThemeContext,
  presetName: string,
): Promise<Result<Theme, ThemeError>> {
  return withThemeLock(async () => {
    const r = await applyPresetImpl(ctx.folder, presetName);
    if (r.ok) broadcastThemeChanged(ctx);
    return r;
  });
}

export async function derivePaletteFromColor(
  ctx: ThemeContext,
  seedColor: string,
  name?: string,
): Promise<Result<DeriveResult, ThemeError>> {
  return withThemeLock(() =>
    DoAsync<DeriveResult, ThemeError>(async function* () {
      const result = yield* $(derivePalette(seedColor, ctx.folder.theme, name));
      const persisted = await persistTheme(ctx.folder, result.theme);
      broadcastThemeChanged(ctx);
      return { ...result, theme: persisted };
    }),
  );
}

export async function matchVibe(
  ctx: ThemeContext,
  description: string,
  opts: MatchVibeOpts = {},
): Promise<Result<MatchVibeResult, ThemeError>> {
  return withThemeLock(async () => {
    const r = await matchVibeImpl(ctx.folder, description, opts);
    if (r.ok) broadcastThemeChanged(ctx);
    return r;
  });
}

export async function matchImage(
  ctx: ThemeContext,
  imagePath: string,
): Promise<Result<MatchImageResult, ThemeError>> {
  return withThemeLock(async () => {
    const r = await matchImageImpl(ctx.folder, imagePath);
    if (r.ok) broadcastThemeChanged(ctx);
    return r;
  });
}

export {
  type ContrastResult,
  type ContrastTier,
  contrastRatio,
  scoreThemeContrast,
  tierForRatio,
} from "./contrast.ts";
export type { DeriveResult } from "./derive-palette.ts";
export type { ThemeError } from "./errors.ts";
export type { MatchImageResult } from "./match-image.ts";
export type { MatchVibeOpts, MatchVibeResult } from "./match-vibe.ts";
export { PRESET_NAMES, PRESETS };
