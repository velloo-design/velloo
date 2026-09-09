/**
 * Self-update, as the canvas sees it.
 *
 * The server package knows nothing about how velloo was installed — npm,
 * `curl | sh`, Homebrew, or a contributor's local build — and must not learn:
 * that is the CLI's business, and the CLI is the package *above* this one. So
 * the daemon is handed a controller, exactly like `CanvasAuth` and
 * `CanvasPublish`. Omit it and the canvas simply never offers an upgrade.
 */

export interface CanvasUpdateStatus {
  /** Build stamp of the running binary, e.g. `0.1.0 (a1b2c3 · 2026-09-08)`. */
  current: string;
  /** Build stamp of the newest release on this channel; null when unknown. */
  latest: string | null;
  available: boolean;
  /** How velloo was installed — shown so the user can predict what upgrading does. */
  method: string;
  /** Which release stream this binary tracks: stable, dev, or a local build. */
  channel: string;
  /** False when this installation can't replace itself (source checkout). */
  upgradable: boolean;
  /** Why an upgrade isn't offered, or why the check couldn't answer. */
  reason?: string;
}

export interface CanvasUpdateResult {
  upgraded: boolean;
  from: string;
  to: string;
  /**
   * True when the design folder still needs `velloo upgrade` after this: the
   * new binary may read a newer on-disk format, and migrating it requires the
   * daemon to be down.
   */
  restartRequired: boolean;
}

export interface CanvasUpdates {
  /** `refresh` forces a network check; without it the cached answer is used. */
  status(opts?: { refresh?: boolean }): Promise<CanvasUpdateStatus>;
  upgrade(): Promise<CanvasUpdateResult>;
}

export const UPDATES_UNAVAILABLE: CanvasUpdateStatus = {
  current: "unknown",
  latest: null,
  available: false,
  method: "unknown",
  channel: "unknown",
  upgradable: false,
  reason: "This canvas was not started by the velloo CLI, so it cannot update itself.",
};
