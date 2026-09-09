/**
 * Pending-velloo-release state, shared by the account menu's badge and the
 * one-time toast.
 *
 * Its own tiny store rather than a design-store slice: nothing here is design
 * state, nothing rerenders a frame, and the poll has to keep running whichever
 * panes are mounted. `useSyncExternalStore` gives components the same
 * subscription the toast uses.
 */
import { useSyncExternalStore } from "react";
import { fetchUpdateStatus, runUpgrade, type UpdateStatus } from "./api.ts";
import { pushToast, toastError } from "./toast.ts";

/** The daemon answers from a cache it refreshes in the background — poll gently. */
const POLL_MS = 15 * 60 * 1000;
const TOASTED_KEY = "velloo:update-toasted";

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface UpdateState {
  status: UpdateStatus | null;
  upgrading: boolean;
}

let snapshot: UpdateState = { status: null, upgrading: false };

function set(next: Partial<UpdateState>): void {
  snapshot = { ...snapshot, ...next };
  emit();
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Read the daemon's cached verdict; `refresh` forces it to ask the network. */
export async function refreshUpdateStatus(opts: { refresh?: boolean } = {}): Promise<void> {
  try {
    set({ status: await fetchUpdateStatus(opts) });
  } catch {
    // An unreachable daemon is already reported by the connection banner; a
    // missed update check is not worth a second complaint.
  }
}

/**
 * A build stamp short enough for a menu chip.
 *
 * A release is just `0.2.0`. A local build is
 * `0.1.0 (ec7210d-dirty · 2026-09-08 14:17)` — the commit is what a
 * contributor cares about in `--version` and noise in a 16rem dropdown, so
 * only the date survives. The full stamp stays in the item's title.
 */
export function compactVersion(stamp: string | null | undefined): string {
  if (!stamp) return "";
  const match = /^(\S+)\s*\((?:.*·\s*)?(.+)\)$/.exec(stamp);
  return match ? `${match[1]} · ${match[2]}` : stamp;
}

/**
 * Announce a pending release once per version per browser. The toast is the
 * only unprompted thing velloo says about updates, so repeating it every time
 * a tab opens would make it noise rather than news.
 */
function announce(next: UpdateStatus): void {
  if (!next.available || !next.latest || !next.upgradable) return;
  try {
    if (localStorage.getItem(TOASTED_KEY) === next.latest) return;
    localStorage.setItem(TOASTED_KEY, next.latest);
  } catch {
    // Private browsing or blocked storage: announce anyway rather than never.
  }
  pushToast({
    kind: "info",
    title: `Velloo ${compactVersion(next.latest)} is available`,
    message: `You're on ${compactVersion(next.current)}.`,
    ttl: 10000,
    action: { label: "Upgrade", onClick: () => void upgradeVelloo() },
  });
}

let watching = false;

/** Start the poll. Idempotent — App mounts once, but StrictMode calls twice. */
export function startUpdateWatch(): void {
  if (watching) return;
  watching = true;
  const tick = async (refresh: boolean) => {
    await refreshUpdateStatus(refresh ? { refresh: true } : {});
    if (snapshot.status) announce(snapshot.status);
  };
  void (async () => {
    // Paint from the daemon's cached answer first — it is instant and usually
    // right — then confirm it against the release host. The cache can be a
    // whole check interval behind (and a contributor's `cli:build` is seconds
    // old), and "you are up to date" is the wrong thing to be confidently
    // wrong about on the one pass that gets to announce itself.
    await tick(false);
    await tick(true);
  })();
  setInterval(() => void tick(true), POLL_MS);
}

/**
 * Run the upgrade the daemon offers. The daemon replaces the binary but keeps
 * serving from the code already in memory, so the honest ending is "restart
 * it" — and that restart is also where the design folder gets migrated, which
 * a running daemon can't do to files it is serving.
 */
export async function upgradeVelloo(): Promise<void> {
  if (snapshot.upgrading) return;
  set({ upgrading: true });
  const pending = pushToast({ kind: "info", message: "Upgrading velloo…", ttl: 60_000 });
  try {
    const result = await runUpgrade();
    if (!result.upgraded) {
      pushToast({ kind: "success", message: `Velloo ${result.to} is already installed.` });
    } else {
      pushToast({
        kind: "success",
        title: `Upgraded to ${result.to}`,
        message: "Quit the canvas and run `velloo upgrade` to finish — it migrates this folder.",
        ttl: 15000,
      });
    }
    await refreshUpdateStatus({ refresh: true });
  } catch (err) {
    toastError(err, "Could not upgrade velloo.");
  } finally {
    dismissToast(pending);
    set({ upgrading: false });
  }
}

/** Sonner ids are opaque strings here; dismissal lives with the toast module. */
function dismissToast(id: string): void {
  if (id) void import("sonner").then(({ toast }) => toast.dismiss(id));
}

/** Test seam: reset the module between suites. */
export function __resetUpdateWatch(): void {
  watching = false;
  snapshot = { status: null, upgrading: false };
}
