import type {
  CommentAnchor,
  CommentLocator,
  CommentNodeFingerprint,
  CommentThreadView,
  Node,
} from "@velloo/schema";
import type { StateCreator } from "zustand";
import {
  type CloudCommentAvailability,
  type CommentScope,
  type CommentScopeFilter,
  type CommentStatusFilter,
  cloudUnavailableHint,
  comments,
} from "../api.ts";
import { iframeRectToBoard } from "../board-geometry.ts";
import { nodeLocator } from "../path.ts";
import { pushToast, toastError } from "../toast.ts";
import type { CanvasState } from "./index.ts";
import { revealPane } from "./modes.ts";
import { selectedNode } from "./selection.ts";

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
  /**
   * Open the draft on the selected node, skipping the pick. Returns false
   * when the selection can't be anchored — nothing selected, or no frame has
   * reported the node's box — and the caller falls back to picking one.
   */
  commentOnSelection(): boolean;
  beginComment(anchor: CommentAnchor): void;
  clearPendingComment(): void;
  /**
   * Post the pinned draft. Resolves to the reason it couldn't be posted, or
   * null once it is a thread — a cloud comment walks through the publish
   * dialog on the way, and a user who backs out of that has a draft still on
   * screen and deserves to be told why it is still there.
   */
  createPendingComment(body: string, scope?: CommentScope): Promise<string | null>;
  /** The same contract for a board-wide thread, which has no canvas pin. */
  createBoardComment(body: string, scope?: CommentScope): Promise<string | null>;
  replyToComment(id: string, body: string): Promise<void>;
  setCommentResolved(id: string, resolved: boolean): Promise<void>;
  moveCommentToCloud(id: string): Promise<void>;
  deleteComment(id: string): Promise<void>;
  /**
   * Take one message back. A cloud message leaves a tombstone behind for the
   * people who already read it; a local one leaves nothing, and a local
   * thread's only message takes the thread with it.
   */
  deleteCommentMessage(id: string, messageId: string): Promise<void>;
}

/**
 * The filter changes a freshly posted thread needs to stay on screen.
 *
 * A new thread is always open and lives in the scope it was posted to, so a
 * list narrowed past it — resolved-only, or the other scope — swallows it on
 * the very next refresh, and posting reads as having failed.
 */
function filtersRevealing(
  state: Pick<CanvasState, "commentStatus" | "commentScope">,
  thread: CommentThreadView,
): Partial<Pick<CanvasState, "commentStatus" | "commentScope">> {
  return {
    ...(state.commentStatus === "resolved" && { commentStatus: "open" as const }),
    ...(state.commentScope !== "all" &&
      state.commentScope !== thread.scope && { commentScope: "all" as const }),
  };
}

function sameLocator(a: CommentLocator, b: CommentLocator): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((step, i) => step === b[i]);
  return a === b;
}

/**
 * What the thread keeps about the node so a stale anchor still reads as
 * something. Picked off the tree rather than the rendered DOM, which the
 * store can't see — so a node whose text comes from a child, a param or a
 * component's own default contributes its `$ref` alone.
 */
function selectionFingerprint(node: Node): CommentNodeFingerprint | undefined {
  const ref = "$ref" in node ? node.$ref : "$snippet" in node ? node.$snippet : undefined;
  const children = "props" in node ? node.props?.children : undefined;
  const text =
    typeof children === "string" ? children.trim().replace(/\s+/g, " ").slice(0, 500) : undefined;
  if (!ref && !text) return undefined;
  return { ...(ref && { ref }), ...(text && { text }) };
}

function replaceThread(threads: CommentThreadView[], next: CommentThreadView): CommentThreadView[] {
  const existing = threads.findIndex((thread) => thread.id === next.id);
  if (existing < 0) return [next, ...threads];
  return threads.map((thread) => (thread.id === next.id ? next : thread));
}

const PUBLISH_ABANDONED =
  "This board wasn't published, so a cloud comment has nowhere to live yet. Publish it, or keep the comment local.";

/**
 * Clear the way for a cloud thread on this board, walking the user through a
 * publish when the missing piece is the published link itself. Resolves to the
 * reason the cloud is still out of reach, or null when it isn't.
 */
async function reachCloud(get: () => CanvasState, boardId: string): Promise<string | null> {
  const cloud = get().cloudComments;
  // Nothing known yet is not a blocker: the daemon refuses a cloud thread it
  // can't place, and guessing here would open a publish dialog over a board
  // that may already have a link.
  if (!cloud || cloud.available) return null;
  if (cloud.reason !== "unpublished") return cloudUnavailableHint(cloud.reason);
  const board = get().boards[boardId];
  if (!board) return PUBLISH_ABANDONED;
  const published = await get().publishAndWait({ id: board.id, name: board.name });
  if (!published) return PUBLISH_ABANDONED;
  // The publish just minted the link this board didn't have; ask for the new
  // answer rather than posting a thread against the stale one.
  await get().refreshCloudComments();
  return get().cloudComments?.available ? null : PUBLISH_ABANDONED;
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
    set((state) => ({
      activeCommentId,
      pendingCommentAnchor: null,
      rightTab: "comments",
      ...revealPane(state, "right"),
      markupVisible: true,
    }));
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
    // A selected node is already the thing the comment is about, so asking
    // for it to be picked again is a click the user has made.
    if (get().commentOnSelection()) return;
    set({
      cursorMode: "comment",
      hover: null,
      pendingCommentAnchor: null,
      activeCommentId: null,
      rightTab: "comments",
      markupVisible: true,
    });
  },

  commentOnSelection() {
    const state = get();
    const selection = state.selection;
    const boardId = state.currentBoardId;
    if (!selection || !boardId) return false;
    // A snippet selection addresses the definition, which is not a screen any
    // frame places — the same reason the comment-mode click ignores one.
    if (selection.screenId.startsWith("snippet:")) return false;
    const node = selectedNode(state.screens, selection);
    if (!node) return false;
    // A screen can be placed more than once; the box is whichever placement
    // has actually measured the node, which is also the only one that can
    // pin the draft beside it.
    const frame = (state.boards[boardId]?.frames ?? []).find(
      (candidate) =>
        candidate.screen === selection.screenId && state.nodeRects[candidate.id]?.[selection.path],
    );
    const bounds = frame ? state.nodeRects[frame.id]?.[selection.path] : undefined;
    if (!frame || !bounds) return false;
    const locator = nodeLocator(node, selection.path);
    // Asking twice for the draft that is already open must not restart it —
    // `beginComment` hands the composer a new anchor, and a new anchor is a
    // new draft, typed text and all.
    const pending = state.pendingCommentAnchor;
    if (
      pending?.kind === "node" &&
      pending.frameId === frame.id &&
      sameLocator(pending.locator, locator)
    )
      return true;
    const fingerprint = selectionFingerprint(node);
    get().beginComment({
      kind: "node",
      boardId,
      frameId: frame.id,
      screenId: selection.screenId,
      locator,
      bounds,
      ...(fingerprint && { fingerprint }),
    });
    return true;
  },

  /**
   * The draft is written on the canvas, beside the thing it is about, so a
   * pane folded away stays folded — it has nothing to show until the thread
   * exists, and opening it here narrows the canvas under the composer.
   */
  beginComment(pendingCommentAnchor) {
    set({
      pendingCommentAnchor,
      activeCommentId: null,
      cursorMode: "select",
      rightTab: "comments",
      markupVisible: true,
    });
  },

  clearPendingComment() {
    set({ pendingCommentAnchor: null });
  },

  async createPendingComment(body, scope = "local") {
    const boardId = get().currentBoardId;
    const anchor = get().pendingCommentAnchor;
    if (!boardId || !anchor || !body.trim()) return "There is nothing to post.";
    if (scope === "shared") {
      const blocked = await reachCloud(get, boardId);
      if (blocked) return blocked;
      // The publish dialog held the floor for a while; the pin it was opened
      // for may have been dropped in the meantime.
      if (get().pendingCommentAnchor !== anchor) return null;
    }
    try {
      const thread = await comments.create({ boardId, body, anchor, scope });
      const filters = filtersRevealing(get(), thread);
      // Posted is when there is a conversation to follow, so this is where the
      // pane earns the width — the draft that preceded it did not.
      set((state) => ({
        commentThreads: replaceThread(state.commentThreads, thread),
        activeCommentId: thread.id,
        pendingCommentAnchor: null,
        rightTab: "comments" as const,
        ...revealPane(state, "right"),
        ...filters,
      }));
      // The rest of the list was fetched under the filter we just left.
      if (Object.keys(filters).length > 0) void get().refreshComments();
      return null;
    } catch (error) {
      toastError(error, "Could not create comment");
      return "The daemon refused the comment. Its message has the details.";
    }
  },

  async createBoardComment(body, scope = "local") {
    const boardId = get().currentBoardId;
    if (!boardId || !body.trim()) return "There is nothing to post.";
    if (scope === "shared") {
      const blocked = await reachCloud(get, boardId);
      if (blocked) return blocked;
    }
    try {
      const thread = await comments.create({ boardId, body, scope });
      const filters = filtersRevealing(get(), thread);
      set((state) => ({
        commentThreads: replaceThread(state.commentThreads, thread),
        activeCommentId: thread.id,
        pendingCommentAnchor: null,
        rightTab: "comments",
        ...filters,
      }));
      if (Object.keys(filters).length > 0) void get().refreshComments();
      return null;
    } catch (error) {
      toastError(error, "Could not create comment");
      return "The daemon refused the comment. Its message has the details.";
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

  async deleteCommentMessage(id, messageId) {
    const thread = get().commentThreads.find((candidate) => candidate.id === id);
    // Nothing survives a local thread's last retraction, and an empty thread
    // is not a thread — take the whole thing rather than leave a husk.
    if (thread?.scope === "local" && thread.messages.length === 1) {
      await get().deleteComment(id);
      return;
    }
    try {
      const thread = await comments.deleteMessage(id, messageId);
      set((state) => ({ commentThreads: replaceThread(state.commentThreads, thread) }));
    } catch (error) {
      toastError(error, "Could not delete comment");
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
    const thread = get().commentThreads.find((candidate) => candidate.id === id);
    if (!thread) return;
    const blocked = await reachCloud(get, thread.boardId);
    if (blocked) {
      pushToast({ kind: "error", title: "The thread is still local", message: blocked });
      return;
    }
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
