import type { CommentAnchor, CommentThreadView } from "@velloo/schema";
import type { StateCreator } from "zustand";
import { type CommentStatusFilter, comments } from "../api.ts";
import { toastError } from "../toast.ts";
import type { CanvasState } from "./index.ts";

export interface CommentsSlice {
  commentThreads: CommentThreadView[];
  commentStatus: CommentStatusFilter;
  activeCommentId: string | null;
  pendingCommentAnchor: CommentAnchor | null;
  commentsVisible: boolean;

  refreshComments(): Promise<void>;
  setCommentStatus(status: CommentStatusFilter): void;
  setActiveComment(id: string | null): void;
  enterCommentMode(): void;
  beginComment(anchor: CommentAnchor): void;
  clearPendingComment(): void;
  createPendingComment(body: string): Promise<void>;
  createBoardComment(body: string): Promise<void>;
  replyToComment(id: string, body: string): Promise<void>;
  setCommentResolved(id: string, resolved: boolean): Promise<void>;
  setCommentAgentRequested(id: string, requested: boolean): Promise<void>;
  deleteComment(id: string): Promise<void>;
  setCommentsVisible(visible: boolean): void;
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
  activeCommentId: null,
  pendingCommentAnchor: null,
  commentsVisible: true,

  async refreshComments() {
    const boardId = get().currentBoardId;
    if (!boardId) {
      set({ commentThreads: [], activeCommentId: null });
      return;
    }
    try {
      const commentThreads = await comments.list(boardId, get().commentStatus);
      set((state) => ({
        commentThreads,
        activeCommentId: commentThreads.some((thread) => thread.id === state.activeCommentId)
          ? state.activeCommentId
          : null,
      }));
    } catch (error) {
      toastError(error, "Could not load comments");
    }
  },

  setCommentStatus(commentStatus) {
    set({ commentStatus });
    void get().refreshComments();
  },

  setActiveComment(activeCommentId) {
    set({ activeCommentId, pendingCommentAnchor: null, rightTab: "comments" });
    const thread = get().commentThreads.find((candidate) => candidate.id === activeCommentId);
    if (thread?.anchor?.kind === "node" && thread.anchorState.status === "attached") {
      get().revealSelection({
        screenId: thread.anchor.screenId,
        path: thread.anchorState.resolvedPath.join("."),
      });
    }
  },

  enterCommentMode() {
    set({
      cursorMode: "comment",
      hover: null,
      pendingCommentAnchor: null,
      activeCommentId: null,
      rightTab: "comments",
      rightPaneCollapsed: false,
      commentsVisible: true,
    });
  },

  beginComment(pendingCommentAnchor) {
    set({
      pendingCommentAnchor,
      activeCommentId: null,
      cursorMode: "select",
      rightTab: "comments",
      rightPaneCollapsed: false,
      commentsVisible: true,
    });
  },

  clearPendingComment() {
    set({ pendingCommentAnchor: null });
  },

  async createPendingComment(body) {
    const boardId = get().currentBoardId;
    const anchor = get().pendingCommentAnchor;
    if (!boardId || !anchor || !body.trim()) return;
    try {
      const thread = await comments.create({ boardId, body, anchor });
      set((state) => ({
        commentThreads: replaceThread(state.commentThreads, thread),
        activeCommentId: thread.id,
        pendingCommentAnchor: null,
      }));
    } catch (error) {
      toastError(error, "Could not create comment");
    }
  },

  async createBoardComment(body) {
    const boardId = get().currentBoardId;
    if (!boardId || !body.trim()) return;
    try {
      const thread = await comments.create({ boardId, body });
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
        }));
      }
    } catch (error) {
      toastError(error, resolved ? "Could not resolve comment" : "Could not reopen comment");
    }
  },

  async setCommentAgentRequested(id, requested) {
    try {
      const thread = await comments.update(id, { agentRequested: requested });
      set((state) => ({ commentThreads: replaceThread(state.commentThreads, thread) }));
    } catch (error) {
      toastError(error, "Could not update the agent request");
    }
  },

  async deleteComment(id) {
    try {
      await comments.delete(id);
      set((state) => ({
        commentThreads: state.commentThreads.filter((candidate) => candidate.id !== id),
        activeCommentId: state.activeCommentId === id ? null : state.activeCommentId,
      }));
    } catch (error) {
      toastError(error, "Could not delete comment");
    }
  },

  setCommentsVisible(commentsVisible) {
    set({ commentsVisible });
  },
});
