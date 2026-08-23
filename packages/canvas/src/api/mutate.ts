import type { Screen } from "@velloo/schema";
import { postMutate } from "./http.ts";

export const mutate = {
  updateFrame(args: {
    boardId: string;
    frameId: string;
    patch: {
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      label?: string | null;
      group?: string | null;
    };
  }) {
    return postMutate<{ frame: unknown }>("update_frame", args);
  },
  updateFrames(args: {
    boardId: string;
    patches: Array<{
      frameId: string;
      patch: {
        x?: number;
        y?: number;
        w?: number;
        h?: number;
        label?: string | null;
        group?: string | null;
      };
    }>;
  }) {
    return postMutate<{ frames: unknown[] }>("update_frames", args);
  },
  addFrame(args: {
    boardId: string;
    screenId: string;
    x?: number;
    y?: number;
    w: number;
    h: number;
    label?: string;
    group?: string;
  }) {
    return postMutate<{ frame: unknown }>("add_frame", args);
  },
  removeFrame(args: { boardId: string; frameId: string }) {
    return postMutate<{ removedFrameId: string }>("remove_frame", args);
  },
  addBoard(args: { name: string; id?: string }) {
    return postMutate<{ boardId: string; board: unknown }>("add_board", args);
  },
  removeBoard(args: { boardId: string }) {
    return postMutate<{ removedBoardId: string }>("remove_board", args);
  },
  reorderBoards(args: { order: string[] }) {
    return postMutate<{ order: string[] }>("reorder_boards", args);
  },
  updateProps(args: { screenId: string; path: number[]; propPatch: Record<string, unknown> }) {
    return postMutate<{ path: number[] }>("update_props", args);
  },
  applyClasses(args: { screenId: string; path: number[]; classes: string }) {
    return postMutate<{ path: number[] }>("apply_classes", args);
  },
  addNode(args: {
    screenId: string;
    parentPath: number[];
    componentRef: string;
    props?: Record<string, unknown>;
  }) {
    return postMutate<{ path: number[] }>("add_node", args);
  },
  removeNode(args: { screenId: string; path: number[] }) {
    return postMutate<{ removedRef: string }>("remove_node", args);
  },
  addScreen(args: { name: string; id?: string }) {
    return postMutate<{ screenId: string; screen: Screen }>("add_screen", args);
  },
  removeScreen(args: { screenId: string }) {
    return postMutate<{
      removedScreenId: string;
      removedFrames: { boardId: string; frameIds: string[] }[];
    }>("remove_screen", args);
  },
  setNodeId(args: {
    screenId: string;
    path: number[] | string;
    /** Pass null to clear. */
    id: string | null;
  }) {
    return postMutate<{ path: number[]; id: string | null }>("set_node_id", args);
  },
  updateSnippetArgs(args: { screenId: string; path: number[]; argPatch: Record<string, unknown> }) {
    return postMutate<{ path: number[] }>("update_snippet_args", args);
  },
};
