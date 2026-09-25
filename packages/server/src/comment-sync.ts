/**
 * Cadence of the share-link comment pull. Fast while someone has a canvas
 * open — a reviewer's comment should appear while the designer is looking —
 * and slow otherwise, when the only reader is an agent that lists on demand.
 */
export interface CommentSyncCadence {
  watchedMs: number;
  idleMs: number;
  /** A canvas that connects this soon after a pull doesn't trigger another. */
  minGapMs: number;
}

export const DEFAULT_COMMENT_SYNC_CADENCE: CommentSyncCadence = {
  watchedMs: 30_000,
  idleMs: 5 * 60_000,
  minGapMs: 5_000,
};

/**
 * Runs `sync` on a self-rescheduling timer whose delay is chosen after each
 * run from how many canvases are connected, so a canvas opening mid-way
 * through a slow wait is caught by `watcherJoined` rather than waiting it out.
 * Never lets a failed sync escape — the daemon outlives any cloud outage.
 */
export class CommentSyncScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private lastStartedAt = Number.NEGATIVE_INFINITY;
  private stopped = false;

  constructor(
    private readonly sync: () => Promise<unknown>,
    private readonly watchers: () => number,
    private readonly cadence: CommentSyncCadence = DEFAULT_COMMENT_SYNC_CADENCE,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    void this.run();
  }

  /**
   * A canvas connected. Pull now so it opens on fresh threads — unless a pull
   * just happened (a reload, a reconnect storm), in which case only make sure
   * the next one comes at the watched cadence.
   */
  watcherJoined(): void {
    if (this.stopped || this.running) return;
    if (this.now() - this.lastStartedAt >= this.cadence.minGapMs) void this.run();
    else this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** The in-flight pull, if any — for tests and shutdown to await. */
  settled(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  private run(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.lastStartedAt = this.now();
    const run = (async () => {
      try {
        await this.sync();
      } catch {
        // sync must never break the server
      }
    })().finally(() => {
      this.running = null;
      this.schedule();
    });
    this.running = run;
    return run;
  }

  private schedule(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = this.watchers() > 0 ? this.cadence.watchedMs : this.cadence.idleMs;
    this.timer = setTimeout(() => void this.run(), delay);
  }
}
