import type { StateCreator } from "zustand";
import { type AuthStatus, auth } from "../api/auth.ts";
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
  signInOpen: boolean;
  publishOpen: boolean;
  /**
   * Set when the publish dialog was opened for one board from its own menu: it
   * skips the form and starts that board publishing immediately. Null for the
   * top bar's Publish, which is the full form over every board.
   */
  publishScope: { id: string; name: string } | null;

  refreshAuth(): Promise<void>;
  setSignInOpen(open: boolean): void;
  setPublishOpen(open: boolean): void;
  publishBoardNow(board: { id: string; name: string }): void;
}

export const createCloudSlice: StateCreator<CanvasState, [], [], CloudSlice> = (set) => ({
  authStatus: null,
  signInOpen: false,
  publishOpen: false,
  publishScope: null,

  async refreshAuth() {
    // A daemon that can't answer is indistinguishable from being logged out for
    // every decision the UI makes, and api/auth already folds failures into
    // that shape — so this never rejects.
    set({ authStatus: await auth.status() });
  },

  setSignInOpen(signInOpen) {
    set({ signInOpen });
  },

  // Both entry points clear the scope: opening the full form must not inherit
  // the last board's, and closing must not leave it armed for next time.
  setPublishOpen(publishOpen) {
    set({ publishOpen, publishScope: null });
  },

  publishBoardNow(board) {
    set({ publishScope: board, publishOpen: true });
  },
});
