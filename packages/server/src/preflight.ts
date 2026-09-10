import type { ComponentProvider, ComponentRegistry } from "@velloo/provider";
import { RenderGuardLimitError, renderBodyGuarded } from "@velloo/renderer";
import type { Screen } from "@velloo/schema";
import type { DesignFolder } from "./design-folder.ts";
import { registryForScreen } from "./extensions/registry.ts";

/**
 * A component that threw while rendering a screen, named with the screen and
 * the boards it sits on so a caller can say *where* before asking whether to
 * go on.
 *
 * The render guard exists so one broken component cannot take a screen down,
 * which means an export or a publish of a broken screen succeeds and produces
 * a file with a diagnostic placeholder sitting in it. That is the right
 * behavior for the canvas, where the author sees the box; it is the wrong
 * thing to discover in a PDF sent to a client or on a share link.
 */
export interface ScreenRenderFailure {
  screenId: string;
  screenName: string;
  /** Every board with a frame placing the screen; empty for a loose screen. */
  boards: { id: string; name: string }[];
  /** The component that threw, or null when the whole screen render failed. */
  componentId: string | null;
  reason: string;
}

export interface PreflightSource {
  folder: DesignFolder;
  providers: Record<string, ComponentProvider>;
  defaultProvider: ComponentProvider;
}

function registryFor(source: PreflightSource): (screen: Screen) => ComponentRegistry {
  const { folder } = source;
  return (screen) =>
    registryForScreen(
      screen,
      source.providers,
      source.defaultProvider,
      folder.config.extensions ?? {},
      folder.config.styling?.framework,
    );
}

function boardsPlacing(folder: DesignFolder, screenId: string): ScreenRenderFailure["boards"] {
  return [...folder.boards.values()]
    .filter((board) => board.frames.some((frame) => frame.screen === screenId))
    .map((board) => ({ id: board.id, name: board.name }));
}

/**
 * Render each screen far enough to learn which components throw.
 *
 * A body render is enough and is deliberately all this does: a component
 * throws or it doesn't, and that answer needs no theme, no compiled CSS, no
 * asset origin, and no browser. So the check costs one SSR per screen and can
 * run before an export or publish commits to the expensive work.
 */
export function preflightScreens(
  source: PreflightSource,
  screens: Iterable<Screen>,
): ScreenRenderFailure[] {
  const registry = registryFor(source);
  const out: ScreenRenderFailure[] = [];
  for (const screen of screens) {
    const where = {
      screenId: screen.id,
      screenName: screen.name,
      boards: boardsPlacing(source.folder, screen.id),
    };
    try {
      for (const failure of renderBodyGuarded(screen, registry(screen), source.folder.snippets)
        .failures) {
        out.push({ ...where, componentId: failure.componentId, reason: failure.reason });
      }
    } catch (error) {
      // Past the stand-in cap every failure is still individually known, and
      // each is its own fix — listing only the one that tipped it would hide
      // the other eight.
      if (error instanceof RenderGuardLimitError) {
        for (const failure of error.failures) {
          out.push({ ...where, componentId: failure.componentId, reason: failure.reason });
        }
      }
      // The guard gave up: an unknown $ref, too many broken components, or a
      // throw it could not pin on one of them. The screen is worse off than a
      // stand-in, not better, so it belongs in the same report.
      out.push({
        ...where,
        componentId: null,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return out;
}

function screenById(folder: DesignFolder, id: string | undefined): Screen | undefined {
  return id === undefined ? undefined : folder.screens.get(id);
}

/** The screens a board puts on the page, in frame order and without repeats. */
export function screensForBoards(folder: DesignFolder, boardIds: Iterable<string>): Screen[] {
  const seen = new Map<string, Screen>();
  for (const boardId of boardIds) {
    const board = folder.boards.get(boardId);
    if (!board) continue;
    for (const frame of board.frames) {
      const screen = screenById(folder, frame.screen);
      if (screen && !seen.has(screen.id)) seen.set(screen.id, screen);
    }
  }
  return [...seen.values()];
}

/** The screens one export target covers. */
export function screensForExportTarget(
  folder: DesignFolder,
  kind: "frame" | "board" | "screen",
  id: string,
): Screen[] {
  if (kind === "board") return screensForBoards(folder, [id]);
  if (kind === "screen") {
    const screen = folder.screens.get(id);
    return screen ? [screen] : [];
  }
  for (const board of folder.boards.values()) {
    const frame = board.frames.find((f) => f.id === id);
    if (!frame) continue;
    const screen = screenById(folder, frame.screen);
    return screen ? [screen] : [];
  }
  return [];
}
