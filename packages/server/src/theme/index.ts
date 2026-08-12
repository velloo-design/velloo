import { $, DoAsync, type Result } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { persistTheme } from "../mutations/persist.ts";
import type { WatchEvent } from "../watcher.ts";
import { applyPreset as applyPresetImpl } from "./apply-preset.ts";
import { type DeriveResult, derivePalette } from "./derive-palette.ts";
import type { ThemeError } from "./errors.ts";
import { type MatchImageResult, matchImage as matchImageImpl } from "./match-image.ts";
import {
  type MatchVibeOpts,
  type MatchVibeResult,
  matchVibe as matchVibeImpl,
} from "./match-vibe.ts";
import { PRESET_NAMES, PRESETS } from "./presets.ts";
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
): Promise<Result<Theme, ThemeError>> {
  return withThemeLock(async () => {
    const r = await setTokenImpl(ctx.folder, path, value);
    if (r.ok) broadcastThemeChanged(ctx);
    return r;
  });
}

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

export type { DeriveResult } from "./derive-palette.ts";
export type { ThemeError } from "./errors.ts";
export type { MatchImageResult } from "./match-image.ts";
export type { MatchVibeOpts, MatchVibeResult } from "./match-vibe.ts";
export { PRESET_NAMES, PRESETS };
