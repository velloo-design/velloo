import type { BoardLimit } from "@velloo/protocol";
import type {
  CanvasCloudAccess,
  CanvasGuests,
  CanvasPublish,
  CanvasPublishDestinations,
  CanvasPublishedBoard,
  CanvasPublishRequest,
  CanvasPublishResult,
  PublishHost,
} from "./cloud.ts";
import { asBoardLimit, asSignInRequired } from "./cloud.ts";

/**
 * One publish at a time per daemon, with progress the canvas can poll.
 *
 * A publish takes tens of seconds (Tailwind, a capture pass, an upload), which
 * is far too long to hold a request open — and two concurrent runs would race
 * on the same folder's `folderId` and the same share link. So the run lives
 * here: `start` kicks it off and returns immediately, and the canvas polls
 * `state()` until it settles. The terminal state is kept afterwards so a tab
 * that reloads (or a second tab) still sees the share URL.
 */

export type PublishRunState =
  | { state: "idle" }
  | {
      state: "running";
      step: string;
      message: string;
      capture?: { done: number; total: number };
      startedAt: string;
      warnings: string[];
    }
  | { state: "done"; result: CanvasPublishResult; warnings: string[]; finishedAt: string }
  | {
      state: "error";
      message: string;
      /**
       * Set when the run died on the credential rather than on the bundle. The
       * dialog offers a sign-in instead of a "Back" button — the failure is
       * one click from being fixed, and a publish that fails after a full
       * capture pass is the worst place to make someone go hunting.
       */
      signInRequired?: "signed-out" | "expired";
      /**
       * Set when the cloud refused because the plan's published-board slots
       * are full. Like `signInRequired` this is a state with a next step —
       * the dialog offers the published list rather than repeating a refusal.
       */
      boardLimit?: BoardLimit;
      warnings: string[];
      finishedAt: string;
    };

/** Moves open cloud threads onto a link; the comments service provides it. */
export type CommentMigrator = (
  threadIds: string[],
  toSlug: string,
) => Promise<{ moved: string[]; skipped: { id: string; reason: string }[] }>;

export class PublishRunner {
  private current: PublishRunState = { state: "idle" };
  private warnings: string[] = [];
  private migrator: CommentMigrator | null = null;

  constructor(
    private readonly publisher: CanvasPublish,
    private readonly host: () => PublishHost,
  ) {}

  state(): PublishRunState {
    return this.current;
  }

  running(): boolean {
    return this.current.state === "running";
  }

  teams(): Promise<{ id: string; name: string }[]> {
    return this.publisher.teams();
  }

  blocked(): Promise<string | null> {
    return this.publisher.blocked?.() ?? Promise.resolve(null);
  }

  destinations(): Promise<CanvasPublishDestinations> {
    return this.publisher.destinations(this.host());
  }

  access(): Promise<CanvasCloudAccess> {
    return this.publisher.access();
  }

  published(): Promise<CanvasPublishedBoard[]> {
    return this.publisher.published();
  }

  unpublish(slug: string): Promise<void> {
    return this.publisher.unpublish(slug);
  }

  /** A published board's guests — straight to the cloud, like the list above. */
  get guests(): CanvasGuests {
    return this.publisher.guests;
  }

  /**
   * Who moves comments after a publish. Set after construction because the
   * comments service is built with this runner in hand.
   */
  setMigrator(migrator: CommentMigrator): void {
    this.migrator = migrator;
  }

  /**
   * Bring the chosen threads onto the link just published. A publish that
   * succeeded stays a success whatever happens here: what didn't move is a
   * warning, with the cloud's reason.
   */
  private async migrate(threadIds: string[], slug: string): Promise<number> {
    if (threadIds.length === 0) return 0;
    if (!this.migrator) {
      this.warnings.push("Comments couldn't be moved: cloud comments aren't available.");
      return 0;
    }
    try {
      const { moved, skipped } = await this.migrator(threadIds, slug);
      for (const { reason } of skipped) this.warnings.push(`A comment wasn't moved: ${reason}.`);
      return moved.length;
    } catch (err) {
      this.warnings.push(
        `Comments couldn't be moved: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }

  /** Begin a publish, or return null when one is already running. */
  start(request: CanvasPublishRequest): PublishRunState | null {
    const { migrateThreadIds = [], ...publishRequest } = request;
    if (this.current.state === "running") return null;
    const startedAt = new Date().toISOString();
    this.warnings = [];
    this.current = {
      state: "running",
      step: "start",
      message: "starting",
      startedAt,
      warnings: this.warnings,
    };

    void this.publisher
      .run(
        this.host(),
        publishRequest,
        ({ step, message, capture }) => {
          // A late event from a superseded run must not overwrite a settled
          // state — only the run that owns the current state may report.
          if (this.current.state !== "running" || this.current.startedAt !== startedAt) return;
          this.current = {
            state: "running",
            step,
            message,
            startedAt,
            warnings: this.warnings,
            ...(capture ? { capture } : {}),
          };
        },
        (message) => {
          this.warnings.push(message);
        },
      )
      .then(async (published) => {
        const migrated = await this.migrate(migrateThreadIds, published.slug);
        const result = migrated > 0 ? { ...published, migratedComments: migrated } : published;
        this.current = {
          state: "done",
          result,
          warnings: this.warnings,
          finishedAt: new Date().toISOString(),
        };
      })
      .catch((err: unknown) => {
        const access = asSignInRequired(err);
        const boardLimit = asBoardLimit(err);
        this.current = {
          state: "error",
          message: err instanceof Error ? err.message : String(err),
          ...(access ? { signInRequired: access } : {}),
          ...(boardLimit ? { boardLimit } : {}),
          warnings: this.warnings,
          finishedAt: new Date().toISOString(),
        };
      });

    return this.current;
  }

  /** Forget a settled run so the dialog reopens clean. Never touches a live one. */
  reset(): void {
    if (this.current.state !== "running") this.current = { state: "idle" };
  }
}
