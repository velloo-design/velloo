/**
 * Frames that follow their screen's height (`fit: "content"`).
 *
 * A page rarely fits a viewport's height, and a frame is a fixed box: the
 * board clipped the page until someone resized the frame, which sent every
 * agent back for an `update_frame` after its first capture — and again after
 * each edit that grew the page. A frame Velloo places itself therefore follows
 * its screen, and so does any frame somebody asks to: the daemon measures the
 * screen shortly after it changes, whoever changed it, and sizes those frames.
 *
 * Measuring means rendering — a small headless capture at the viewport the
 * frame's width names — because the canvas cannot tell from inside a frame
 * that a page got shorter: a `min-h-screen` root is always as tall as the
 * frame showing it.
 */
import { isArchived, type Screen, type Viewport } from "@velloo/schema";
import { updateFrames } from "./mutations/api/frames.ts";
import type { MutationContext } from "./mutations/context.ts";

/** How tall a screen renders at a viewport, or null where that can't be found out. */
export type MeasureScreen = (screen: Screen, viewport: Viewport) => Promise<number | null>;

export interface FittedFrame {
  board: string;
  frame: string;
  h: number;
}

/** Two renders of one screen differ by a pixel of rounding; not worth a write. */
const JITTER = 2;

/**
 * The shortest a frame of this width gets: a page that ends above the fold
 * still shows as the viewport it is designed for, when the folder names one.
 */
function floorFor(ctx: MutationContext, w: number): number {
  return ctx.folder.config.viewportPresets.find((preset) => preset.w === w)?.h ?? 0;
}

/** The widths at which some live board shows `screenId` in a frame that follows it. */
function followingWidths(ctx: MutationContext, screenId: string): number[] {
  const widths = new Set<number>();
  for (const board of ctx.folder.boards.values()) {
    if (isArchived(board)) continue;
    for (const frame of board.frames) {
      if (frame.screen === screenId && frame.fit === "content") widths.add(frame.w);
    }
  }
  return [...widths];
}

/**
 * `screenId` was seen to render `contentHeight` tall at `viewportW`: size the
 * frames of that width that follow it. Height depends on width, so a desktop
 * render says nothing about a mobile frame.
 */
export async function fitFramesTo(
  ctx: MutationContext,
  screenId: string,
  contentHeight: number,
  viewportW: number,
): Promise<FittedFrame[]> {
  if (contentHeight <= 0) return [];
  const h = Math.max(floorFor(ctx, viewportW), Math.round(contentHeight));
  const out: FittedFrame[] = [];
  for (const board of ctx.folder.boards.values()) {
    if (isArchived(board)) continue;
    const patches = board.frames
      .filter(
        (frame) =>
          frame.screen === screenId &&
          frame.fit === "content" &&
          frame.w === viewportW &&
          Math.abs(frame.h - h) >= JITTER,
      )
      // `fit` rides along: a height on its own is someone sizing the frame.
      .map((frame) => ({ frameId: frame.id, patch: { h, fit: "content" as const } }));
    if (patches.length === 0) continue;
    const resized = await updateFrames(ctx, { boardId: board.id, patches });
    if (!resized.ok) continue;
    for (const { frameId } of patches) out.push({ board: board.id, frame: frameId, h });
  }
  return out;
}

export interface FrameFitter {
  /** Measure `screenId` now and size the frames that follow it. */
  fit(screenId: string): Promise<FittedFrame[]>;
  /**
   * `screenId` may have just changed: fit it shortly, off the caller's path.
   * A burst of edits is one measurement, and a tree already measured is none —
   * unless `force`, for a change the tree doesn't show (a frame's width, a
   * frame that has just started following).
   */
  later(screenId: string, force?: boolean): void;
}

/** A fitter over one folder. `measure` is the daemon's capture pipeline. */
export function createFrameFitter(
  ctx: MutationContext,
  measure: MeasureScreen,
  delayMs = 400,
): FrameFitter {
  // The tree each screen had when it was last measured: mutations replace the
  // tree, so the same object is the same content.
  const measured = new Map<string, unknown>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const current = (screenId: string): boolean => {
    const screen = ctx.folder.screens.get(screenId);
    return screen !== undefined && measured.get(screenId) === screen.tree;
  };
  const fit = async (screenId: string): Promise<FittedFrame[]> => {
    const screen = ctx.folder.screens.get(screenId);
    if (!screen) return [];
    measured.set(screenId, screen.tree);
    const out: FittedFrame[] = [];
    for (const w of followingWidths(ctx, screenId)) {
      const height = await measure(screen, { w, h: floorFor(ctx, w) || 900 });
      if (height !== null) out.push(...(await fitFramesTo(ctx, screenId, height, w)));
    }
    return out;
  };
  return {
    fit,
    later(screenId, force = false) {
      if (force) measured.delete(screenId);
      if (current(screenId) || followingWidths(ctx, screenId).length === 0) return;
      clearTimeout(pending.get(screenId));
      const timer = setTimeout(() => {
        pending.delete(screenId);
        // Something that waits for its own fit (a whole-tree compose) may have
        // measured this tree in the meantime.
        if (current(screenId)) return;
        // Best effort by design: a frame left a little short is the old behaviour.
        void fit(screenId).catch(() => {});
      }, delayMs);
      // Never the reason a daemon or a test run stays alive.
      timer.unref?.();
      pending.set(screenId, timer);
    },
  };
}
