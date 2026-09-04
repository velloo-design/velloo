import type { CommentAnchor, CommentThreadView } from "@velloo/schema";
import type { StateCreator } from "zustand";
import {
  type CloudCommentAvailability,
  type CommentScope,
  type CommentScopeFilter,
  type CommentStatusFilter,
  comments,
} from "../api.ts";
import { iframeRectToBoard } from "../board-geometry.ts";
import { toastError } from "../toast.ts";
import type { CanvasState } from "./index.ts";

export interface CommentsSlice {
  commentThreads: CommentThreadView[];
  commentStatus: CommentStatusFilter;
  commentScope: CommentScopeFilter;
  /** `undefined` while the board's cloud target is still being resolved. */
  cloudComments: CloudCommentAvailability | undefined;
  activeCommentId: string | null;
  pendingCommentAnchor: CommentAnchor | null;

  refreshComments(): Promise<void>;
  refreshCloudComments(): Promise<void>;
  setCommentStatus(status: CommentStatusFilter): void;
  setCommentScope(scope: CommentScopeFilter): void;
  setActiveComment(id: string | null): void;
  locateComment(id: string): void;
  enterCommentMode(): void;
  beginComment(anchor: CommentAnchor): void;
  clearPendingComment(): void;
  createPendingComment(body: string, scope?: CommentScope): Promise<void>;
  createBoardComment(body: string, scope?: CommentScope): Promise<void>;
  replyToComment(id: string, body: string): Promise<void>;
  setCommentResolved(id: string, resolved: boolean): Promise<void>;
  moveCommentToCloud(id: string): Promise<void>;
  deleteComment(id: string): Promise<void>;
}

function replaceThread(threads: CommentThreadView[], next: CommentThreadView): CommentThreadView[] {
  const existing = threads.findIndex((thread) => thread.id === next.id);
  if (existing < 0) return [next, ...threads];
  return threads.map((thread) => (thread.id === next.id ? next : thread));
}

export const createCommentsSlice: StateCreator<CanvasState, [], [], CommentsSlice> = (
  set,
  get,
) => ({
  commentThreads: [],
  commentStatus: "open",
  commentScope: "all",
  cloudComments: undefined,
  activeCommentId: null,
  pendingCommentAnchor: null,

  async refreshComments() {
    const boardId = get().currentBoardId;
    if (!boardId) {
      set({ commentThreads: [], activeCommentId: null });
      return;
    }
    try {
      const commentThreads = await comments.list(boardId, get().commentStatus, get().commentScope);
      set((state) => {
        const activeStillVisible = commentThreads.some(
          (thread) => thread.id === state.activeCommentId,
        );
        return {
          commentThreads,
          activeCommentId: activeStillVisible ? state.activeCommentId : null,
          ...(!activeStillVisible && state.activeCommentId
            ? { selection: null, reveal: null, rightTab: "comments" as const }
            : {}),
        };
      });
    } catch (error) {
      toastError(error, "Could not load comments");
    }
  },

  async refreshCloudComments() {
    const boardId = get().currentBoardId;
    if (!boardId) {
      set({ cloudComments: { available: false, reason: "unsupported" } });
      return;
    }
    set({ cloudComments: undefined });
    try {
      const availability = await comments.cloudAvailability(boardId);
      if (get().currentBoardId === boardId) set({ cloudComments: availability });
    } catch {
      // An unreachable daemon route is indistinguishable from no cloud at all
      // from here, and either way the composer offers local only.
      set({ cloudComments: { available: false, reason: "unsupported" } });
    }
  },

  setCommentStatus(commentStatus) {
    set({ commentStatus });
    void get().refreshComments();
  },

  setCommentScope(commentScope) {
    set({ commentScope });
    void get().refreshComments();
  },

  setActiveComment(activeCommentId) {
    if (activeCommentId === null) {
      // An anchored thread selects its node for the iframe highlight. Clear
      // that implementation-detail selection when returning to the list so
      // RightPanel cannot mistake it for a fresh node click and switch tabs.
      set({
        activeCommentId: null,
        pendingCommentAnchor: null,
        selection: null,
        reveal: null,
        rightTab: "comments",
      });
      return;
    }
    set({
      activeCommentId,
      pendingCommentAnchor: null,
      rightTab: "comments",
      rightPaneCollapsed: false,
      markupVisible: true,
    });
    get().locateComment(activeCommentId);
  },

  locateComment(id) {
    const thread = get().commentThreads.find((candidate) => candidate.id === id);
    if (!thread?.anchor) return;
    const anchor = thread.anchor;
    if (anchor.kind === "board") {
      get().flyToBoardRect({ x: anchor.x - 7, y: anchor.y - 7, w: 14, h: 14 });
      return;
    }
    if (thread.anchorState.status === "attached") {
      void get().locateNode(anchor.screenId, thread.anchorState.resolvedPath.join("."), {
        frameId: anchor.frameId,
        preserveTab: true,
      });
      return;
    }
    const board = get().boards[thread.boardId];
    const frame = board?.frames.find((candidate) => candidate.id === anchor.frameId);
    if (!frame) return;
    const inset = get().frameInsets[frame.id] ?? { x: 0, y: 0, chromeH: 0 };
    get().flyToBoardRect(iframeRectToBoard(frame, inset, anchor.bounds));
  },

  enterCommentMode() {
    set({
      cursorMode: "comment",
      hover: null,
      pendingCommentAnchor: null,
      activeCommentId: null,
      rightTab: "comments",
      rightPaneCollapsed: false,
      markupVisible: true,
    });
  },

  beginComment(pendingCommentAnchor) {
    set({
      pendingCommentAnchor,
      activeCommentId: null,
      cursorMode: "select",
      rightTab: "comments",
      rightPaneCollapsed: false,
      markupVisible: true,
    });
  },

  clearPendingComment() {
    set({ pendingCommentAnchor: null });
  },

  async createPendingComment(body, scope = "local") {
    const boardId = get().currentBoardId;
    const anchor = get().pendingCommentAnchor;
    if (!boardId || !anchor || !body.trim()) return;
    try {
      const thread = await comments.create({ boardId, body, anchor, scope });
      set((state) => ({
        commentThreads: replaceThread(state.commentThreads, thread),
        activeCommentId: thread.id,
        pendingCommentAnchor: null,
      }));
    } catch (error) {
      toastError(error, "Could not create comment");
    }
  },

  async createBoardComment(body, scope = "local") {
    const boardId = get().currentBoardId;
    if (!boardId || !body.trim()) return;
    try {
      const thread = await comments.create({ boardId, body, scope });
      set((state) => ({
        commentThreads: replaceThread(state.commentThreads, thread),
        activeCommentId: thread.id,
        pendingCommentAnchor: null,
        rightTab: "comments",
      }));
    } catch (error) {
      toastError(error, "Could not create comment");
    }
  },

  async replyToComment(id, body) {
    if (!body.trim()) return;
    try {
      const thread = await comments.reply(id, body);
      set((state) => ({ commentThreads: replaceThread(state.commentThreads, thread) }));
    } catch (error) {
      toastError(error, "Could not reply");
    }
  },

  async setCommentResolved(id, resolved) {
    try {
      const thread = await comments.update(id, { resolved });
      if (get().commentStatus === "all" || get().commentStatus === thread.status) {
        set((state) => ({ commentThreads: replaceThread(state.commentThreads, thread) }));
      } else {
        set((state) => ({
          commentThreads: state.commentThreads.filter((candidate) => candidate.id !== id),
          activeCommentId: state.activeCommentId === id ? null : state.activeCommentId,
          ...(state.activeCommentId === id
            ? { selection: null, reveal: null, rightTab: "comments" as const }
            : {}),
        }));
      }
    } catch (error) {
      toastError(error, resolved ? "Could not resolve comment" : "Could not reopen comment");
    }
  },

  async moveCommentToCloud(id) {
    try {
      // Promotion recreates the conversation on the published link, so the
      // thread comes back under a new id and the local one no longer exists.
      const thread = await comments.update(id, { scope: "shared" });
      set((state) => {
        const without = state.commentThreads.filter((candidate) => candidate.id !== id);
        const visible = state.commentScope !== "local";
        return {
          commentThreads: visible ? replaceThread(without, thread) : without,
          activeCommentId: visible ? thread.id : null,
          ...(visible ? {} : { selection: null, reveal: null, rightTab: "comments" as const }),
        };
      });
    } catch (error) {
      toastError(error, "Could not move the comment to the cloud");
    }
  },

  async deleteComment(id) {
    try {
      await comments.delete(id);
      set((state) => ({
        commentThreads: state.commentThreads.filter((candidate) => candidate.id !== id),
        activeCommentId: state.activeCommentId === id ? null : state.activeCommentId,
        ...(state.activeCommentId === id
          ? { selection: null, reveal: null, rightTab: "comments" as const }
          : {}),
      }));
    } catch (error) {
      toastError(error, "Could not delete comment");
    }
  },
});
