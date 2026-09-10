import type { StateCreator } from "zustand";
import { type AuthStatus, auth, credentialJustRejected } from "../api/auth.ts";
import type { SignInPrompt } from "../api/sign-in-gate.ts";
import { pushToast } from "../toast.ts";
import type { CanvasState } from "./index.ts";

/**
 * velloo-cloud state the chrome shares: who's signed in, and which of the two
 * cloud dialogs is open. Account state lives here rather than in the account
 * menu's own `useState` because the Publish dialog needs the same answer — a
 * publish is impossible while signed out, and it should say so without a
 * second round trip.
 */
export interface CloudSlice {
  /** Null until the first fetch resolves. */
  authStatus: AuthStatus | null;
  /**
   * The open sign-in dialog and what it should say. Null = closed, so there is
   * one field to read instead of a boolean that can disagree with its context.
   */
  signInPrompt: SignInPrompt | null;
  publishOpen: boolean;
  /**
   * Set when the publish dialog was opened for one board from its own menu: it
   * carries the chosen access mode. Public/private start immediately;
   * password-protected stops briefly to collect the password. Null for the top
   * bar's Publish, which is the full form over every board.
   */
  publishScope: { id: string; name: string; mode: PublishAccessMode } | null;

  refreshAuth(): Promise<void>;
  openSignIn(prompt?: SignInPrompt): void;
  closeSignIn(): void;
  setPublishOpen(open: boolean): void;
  publishBoardNow(board: { id: string; name: string }, mode: PublishAccessMode): void;
  /**
   * Open the publish dialog for one board and report back what became of it:
   * true once a run has finished, false if the dialog closed without one.
   *
   * For the work a publish *unblocks* rather than the publish itself — a cloud
   * comment cannot exist before its board has a link, so posting one walks
   * through here first and has to know whether it may carry on. The dialog
   * still asks for confirmation; the destination is never inferred just
   * because something was waiting on it.
   */
  publishAndWait(board: { id: string; name: string }): Promise<boolean>;
  /** Hand that verdict over. Called once per wait; later calls do nothing. */
  settlePublish(published: boolean): void;
}

type PublishAccessMode = "public" | "private" | "password";

/** Resolvers parked by {@link CloudSlice.publishAndWait}. */
let publishWaiters: ((published: boolean) => void)[] = [];

export const createCloudSlice: StateCreator<CanvasState, [], [], CloudSlice> = (set, get) => ({
  authStatus: null,
  signInPrompt: null,
  publishOpen: false,
  publishScope: null,

  async refreshAuth() {
    // A daemon that can't answer is indistinguishable from being logged out for
    // every decision the UI makes, and api/auth already folds failures into
    // that shape — so this never rejects.
    const next = await auth.status();
    const announce = credentialJustRejected(get().authStatus, next);
    set({ authStatus: next });
    // A toast rather than the dialog: nothing was interrupted, so opening a
    // modal over whatever the user is doing would be the wrong size of
    // interruption. The action makes it one click either way.
    if (announce) {
      pushToast({
        kind: "error",
        title: "velloo-cloud session ended",
        message: "Publishing and cloud comments need you to sign in again.",
        ttl: 10_000,
        action: { label: "Sign in", onClick: () => get().openSignIn({ expired: true }) },
      });
    }
  },

  openSignIn(prompt = {}) {
    set({ signInPrompt: prompt });
  },

  closeSignIn() {
    set({ signInPrompt: null });
  },

  // Both entry points clear the scope: opening the full form must not inherit
  // the last board's, and closing must not leave it armed for next time. They
  // also settle any wait — a dialog closed by hand published nothing, and one
  // reopened for something else is no longer the publish that was waited on.
  setPublishOpen(publishOpen) {
    get().settlePublish(false);
    set({ publishOpen, publishScope: null });
  },

  publishBoardNow(board, mode) {
    get().settlePublish(false);
    set({ publishScope: { ...board, mode }, publishOpen: true });
  },

  publishAndWait(board) {
    set({ publishScope: { ...board, mode: "public" }, publishOpen: true });
    return new Promise((resolve) => {
      publishWaiters.push(resolve);
    });
  },

  settlePublish(published) {
    const waiting = publishWaiters;
    publishWaiters = [];
    for (const resolve of waiting) resolve(published);
    // A finished run may have just given this board its first link, which is
    // the very blocker the comment target reports. Nothing else refreshes it,
    // so a publish used to leave the picker disabled until the panel remounted.
    // Whoever was waiting re-reads it for itself, and shouldn't race this one.
    if (published && waiting.length === 0) void get().refreshCloudComments();
  },
});
