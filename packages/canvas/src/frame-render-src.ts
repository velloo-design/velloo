import { type Frame, type FrameScheme, resolveFrameScheme } from "@velloo/schema";
import { renderUrl } from "./api.ts";

export function frameRenderSrc(opts: {
  frame: Pick<Frame, "screen" | "w" | "h" | "scheme">;
  canvasDefault: FrameScheme;
  boardTheme?: string;
  screenRevision: number;
  themeVersion: number;
}): string {
  const { frame, canvasDefault, boardTheme, screenRevision, themeVersion } = opts;
  const scheme = resolveFrameScheme(frame, canvasDefault);
  return `${renderUrl(frame.screen, frame.w, frame.h, boardTheme)}&mode=${scheme}&v=${screenRevision}.${themeVersion}`;
}

export function previewRenderSrc(opts: {
  screenId: string;
  width: number;
  height: number;
  boardTheme?: string;
  scheme?: FrameScheme;
  canvasDefault: FrameScheme;
  screenRevision: number;
  themeVersion: number;
}): string {
  const {
    screenId,
    width,
    height,
    boardTheme,
    scheme,
    canvasDefault,
    screenRevision,
    themeVersion,
  } = opts;
  const resolved = resolveFrameScheme({ scheme }, canvasDefault);
  return `${renderUrl(screenId, width, height, boardTheme)}&mode=${resolved}&v=${screenRevision}.${themeVersion}`;
}
