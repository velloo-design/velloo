import type { StateCreator } from "zustand";
import { type AuthStatus, auth, credentialJustRejected } from "../api/auth.ts";
import { type PublishSlot, publish } from "../api/publish.ts";
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
   * Set when the publish dialog was opened for one board from its own menu,
   * which ticks that board. Null for the top bar's Publish, which ticks none.
   */
  publishScope: { id: string; name: string } | null;
  /** Whether the published-board manager is open. */
  publishedBoardsOpen: boolean;
  /** The published board whose guests are being managed; null when that dialog is closed. */
  guestsBoard: { slug: string; title: string } | null;
  /**
   * The links this folder could publish into, as of the last refresh. Cached
   * rather than fetched per render: each entry names the boards it carries, so
   * a board row can offer "see the latest publish" without a round trip of its
   * own — and the cached answer keeps that menu item from appearing a beat
   * after the menu does.
   */
  publishSlots: PublishSlot[];

  refreshAuth(): Promise<void>;
  openSignIn(prompt?: SignInPrompt): void;
  closeSignIn(): void;
  setPublishOpen(open: boolean): void;
  setPublishedBoardsOpen(open: boolean): void;
  openGuests(board: { slug: string; title: string } | null): void;
  /**
   * Re-read the publish destinations. Never rejects — a miss just hides a menu
   * item. Cheap to call: a fetch newer than {@link SLOTS_FRESH_MS} is reused
   * unless `force`, so opening board menus doesn't hit the cloud each time.
   */
  refreshPublishSlots(opts?: { force?: boolean }): Promise<void>;
  /** Open the publish dialog with this board ticked. */
  publishBoard(board: { id: string; name: string }): void;
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

/** Resolvers parked by {@link CloudSlice.publishAndWait}. */
let publishWaiters: ((published: boolean) => void)[] = [];

/**
 * The newest publish that carried this board, or null when it has never been
 * in one. A slot with no version was reserved and never filled, so it is not
 * something the user can go and look at.
 */
export function latestPublishForBoard(slots: PublishSlot[], boardId: string): PublishSlot | null {
  return (
    slots
      .filter((slot) => slot.latestVersionId !== null && slot.context.boardIds.includes(boardId))
      .sort((left, right) => publishedAt(right.lastPublishedAt) - publishedAt(left.lastPublishedAt))
      .at(0) ?? null
  );
}

const publishedAt = (value: string | null): number => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

/**
 * How long a destinations read stands. Each one is a live cloud call, and the
 * board menu asks on every open — long enough that browsing menus costs one
 * request, short enough that a link removed on the cloud's own page stops
 * being offered here within a browse.
 */
const SLOTS_FRESH_MS = 30_000;

let slotsFetchedAt = 0;
/** The in-flight read, so several menus opening at once share one request. */
let slotsInFlight: Promise<void> | null = null;

export const createCloudSlice: StateCreator<CanvasState, [], [], CloudSlice> = (set, get) => ({
  authStatus: null,
  signInPrompt: null,
  publishOpen: false,
  publishScope: null,
  publishedBoardsOpen: false,
  guestsBoard: null,
  publishSlots: [],

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

  setPublishedBoardsOpen(publishedBoardsOpen) {
    set({ publishedBoardsOpen });
  },

  openGuests(guestsBoard) {
    set({ guestsBoard });
  },

  refreshPublishSlots({ force = false } = {}) {
    if (!get().authStatus?.loggedIn) {
      slotsFetchedAt = 0;
      set({ publishSlots: [] });
      return Promise.resolve();
    }
    if (!force && Date.now() - slotsFetchedAt < SLOTS_FRESH_MS) return Promise.resolve();
    if (slotsInFlight && !force) return slotsInFlight;
    // Signed out, expired, or a cloud that didn't answer all read the same way
    // here: nothing to point at, so the affordance stays hidden.
    slotsInFlight = publish
      .targets()
      .catch(() => null)
      .then((targets) => {
        slotsFetchedAt = Date.now();
        slotsInFlight = null;
        set({ publishSlots: targets?.slots ?? [] });
      });
    return slotsInFlight;
  },

  publishBoard(board) {
    get().settlePublish(false);
    set({ publishScope: { id: board.id, name: board.name }, publishOpen: true });
  },

  publishAndWait(board) {
    set({ publishScope: { id: board.id, name: board.name }, publishOpen: true });
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
    // The same run is what puts a board's first link in reach of its menu, so
    // this read cannot wait out the freshness window.
    if (published) void get().refreshPublishSlots({ force: true });
  },
});
