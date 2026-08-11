import type { Theme } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { persistTheme } from "../mutations/persist.ts";
import type { WatchEvent } from "../watcher.ts";
import { applyPreset as applyPresetImpl } from "./apply-preset.ts";
import { type DeriveResult, derivePalette } from "./derive-palette.ts";
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
): Promise<Theme> {
  return withThemeLock(async () => {
    const t = await setTokenImpl(ctx.folder, path, value);
    broadcastThemeChanged(ctx);
    return t;
  });
}

export async function applyPreset(ctx: ThemeContext, presetName: string): Promise<Theme> {
  return withThemeLock(async () => {
    const t = await applyPresetImpl(ctx.folder, presetName);
    broadcastThemeChanged(ctx);
    return t;
  });
}

export async function derivePaletteFromColor(
  ctx: ThemeContext,
  seedColor: string,
  name?: string,
): Promise<DeriveResult> {
  return withThemeLock(async () => {
    const result = derivePalette(seedColor, ctx.folder.theme, name);
    const persisted = await persistTheme(ctx.folder, result.theme);
    broadcastThemeChanged(ctx);
    return { ...result, theme: persisted };
  });
}

export async function matchVibe(
  ctx: ThemeContext,
  description: string,
  opts: MatchVibeOpts = {},
): Promise<MatchVibeResult> {
  return withThemeLock(async () => {
    const result = await matchVibeImpl(ctx.folder, description, opts);
    broadcastThemeChanged(ctx);
    return result;
  });
}

export async function matchImage(ctx: ThemeContext, imagePath: string): Promise<MatchImageResult> {
  return withThemeLock(async () => {
    const result = await matchImageImpl(ctx.folder, imagePath);
    broadcastThemeChanged(ctx);
    return result;
  });
}

export type { DeriveResult } from "./derive-palette.ts";
export type { ThemeErrorCode, ThemeErrorPayload } from "./errors.ts";
export { ThemeError } from "./errors.ts";
export type { MatchImageResult } from "./match-image.ts";
export type { MatchVibeOpts, MatchVibeResult } from "./match-vibe.ts";
export { PRESET_NAMES, PRESETS };
