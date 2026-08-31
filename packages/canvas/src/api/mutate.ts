import { postMutate } from "./http.ts";

export interface AddedFrame {
  id: string;
  screen: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  group?: string;
}

export const mutate = {
  addFrame(args: {
    boardId: string;
    screenId: string;
    x?: number;
    y?: number;
    w: number;
    h: number;
    label?: string;
    group?: string;
    id?: string;
  }) {
    return postMutate<{ frame: AddedFrame }>("add_frame", args);
  },
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
  removeFrame(args: { boardId: string; frameId: string }) {
    return postMutate<{ removedFrameId: string }>("remove_frame", args);
  },
  addBoard(args: { name: string; id?: string }) {
    return postMutate<{ boardId: string; board: unknown }>("add_board", args);
  },
  updateBoard(args: { boardId: string; patch: { name?: string; theme?: string | null } }) {
    return postMutate<{ board: unknown }>("update_board", args);
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
