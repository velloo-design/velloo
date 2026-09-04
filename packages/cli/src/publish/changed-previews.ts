import type { Board, Screen, Snippet } from "@velloo/schema";
import {
  classifyChanges,
  detectChangedScreens,
  diffDesignFolder,
  type RawChange,
  resolveGitContext,
} from "../ci/diff.ts";

export interface ChangedPreviewSelection {
  screenIds: Set<string>;
  boardIds: Set<string>;
}

/** A direct boards/<id>.json change affects the composite even if no screen pixels changed. */
function changedBoardId(path: string): string | null {
  if (!path.startsWith("boards/") || !path.endsWith(".json")) return null;
  const id = path.slice("boards/".length, -".json".length);
  return id.includes("/") || id.includes(".") ? null : id;
}

/**
 * Reuse CI's dependency-aware screen classifier, then expand those changes to
 * the selected board composites that place an affected screen.
 */
export function selectChangedPreviews(
  changes: RawChange[],
  screens: Screen[],
  snippets: Map<string, Snippet>,
  boards: Board[],
): ChangedPreviewSelection {
  const availableScreens = new Map(screens.map((screen) => [screen.id, screen]));
  const screenIds = new Set(
    detectChangedScreens(classifyChanges(changes), availableScreens, snippets)
      .filter((change) => change.status !== "deleted" && availableScreens.has(change.id))
      .map((change) => change.id),
  );
  const directlyChangedBoards = new Set(
    changes.map((change) => changedBoardId(change.path)).filter((id): id is string => id !== null),
  );
  const boardIds = new Set(
    boards
      .filter(
        (board) =>
          directlyChangedBoards.has(board.id) ||
          board.frames.some((frame) => screenIds.has(frame.screen)),
      )
      .map((board) => board.id),
  );
  return { screenIds, boardIds };
}

/** Compare a base ref with HEAD plus working-tree changes for focused publishing. */
export function changedPreviewsSince(
  designFolder: string,
  baseRef: string,
  screens: Screen[],
  snippets: Map<string, Snippet>,
  boards: Board[],
): ChangedPreviewSelection {
  const git = resolveGitContext(designFolder, baseRef, "HEAD");
  return selectChangedPreviews(diffDesignFolder(git), screens, snippets, boards);
}
