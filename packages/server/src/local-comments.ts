import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OwnerAuthorKind } from "@velloo/protocol/comments";
import {
  type CommentAnchor,
  CommentAnchorSchema,
  type CommentAuthor,
  CommentAuthorSchema,
  type CommentMessage,
  type CommentThread,
  CommentThreadSchema,
  type CommentThreadView,
} from "@velloo/schema";
import { z } from "zod";
import type { CanvasCloudAccess, CanvasPublishSlot, CloudAuth } from "./cloud.ts";
import { SharedCommentsClient, type SharedRefreshResult } from "./cloud-comments.ts";
import { writeJsonAtomic } from "./fs.ts";
import type { MutationContext } from "./mutations/index.ts";
import { resolveLocator } from "./path.ts";

const LocalCommentsFileSchema = z.object({
  version: z.literal(1),
  folderId: z.string().min(1),
  threads: z.array(CommentThreadSchema),
});

interface LocalCommentsFile extends z.infer<typeof LocalCommentsFileSchema> {}

export class CommentStoreError extends Error {
  constructor(
    readonly code: "invalid" | "not-found",
    message: string,
  ) {
    super(message);
  }
}

export interface CreateLocalCommentInput {
  boardId: string;
  body: string;
  anchor?: CommentAnchor | undefined;
  author?: CommentAuthor | undefined;
  /** `shared` authors the thread on the board's published link instead of on disk. */
  scope?: CommentScope | undefined;
}

export interface ReplyToCommentInput {
  body: string;
  author?: CommentAuthor | undefined;
}

export type CommentScope = "local" | "shared";
export type CommentScopeFilter = CommentScope | "all";

/**
 * Just enough of the publish runner to find the share link a cloud comment
 * belongs to. Kept structural so the comment store stays testable without a
 * publisher, and so it never learns how publishing actually works.
 */
export interface CloudCommentTargets {
  access(): Promise<CanvasCloudAccess>;
  destinations(): Promise<{ slots: CanvasPublishSlot[] }>;
}

export type CloudCommentAvailability =
  | { available: true; slug: string; url: string }
  /**
   * `expired` is separate from `signed-out` because the way out differs in
   * one word — sign in *again* — and because conflating them is what let a
   * rejected credential look like a working one until the write failed.
   */
  | { available: false; reason: "signed-out" | "expired" | "unpublished" | "unsupported" };

/**
 * The newest published link carrying this board. A board can sit in several
 * links; the most recent publish is the one a reviewer is looking at.
 */
export function newestPublishedSlot(
  slots: CanvasPublishSlot[],
  boardId: string,
): CanvasPublishSlot | undefined {
  return slots
    .filter((slot) => slot.latestVersionId !== null && slot.context.boardIds.includes(boardId))
    .sort((left, right) => {
      const leftAt = left.lastPublishedAt ? Date.parse(left.lastPublishedAt) : 0;
      const rightAt = right.lastPublishedAt ? Date.parse(right.lastPublishedAt) : 0;
      return rightAt - leftAt || left.slug.localeCompare(right.slug);
    })[0];
}

const defaultAuthor = (): CommentAuthor => ({ kind: "user" });

/**
 * How a folder-side author presents on a published thread. Only the agent and
 * the person at the canvas can write from here — a `reviewer` reaches a thread
 * through the share link, never through this service.
 */
function ownerAuthorKind(author: CommentAuthor | undefined): OwnerAuthorKind {
  return author?.kind === "agent" ? "agent" : "user";
}

function folderIdentity(ctx: MutationContext): string {
  return ctx.folder.config.folderId ?? Bun.CryptoHasher.hash("sha256", ctx.folder.root, "hex");
}

/** Machine-local persistence; never returns a path inside the design folder. */
export function localCommentsPath(folderId: string): string {
  const override = process.env.VELLOO_COMMENTS_PATH;
  if (override) return override;
  const safe = folderId.replace(/[^A-Za-z0-9_-]/g, "_");
  return join(
    process.env.VELLOO_COMMENTS_DIR ?? join(homedir(), ".velloo", "comments"),
    `${safe}.json`,
  );
}

function message(body: string, author: CommentAuthor, now: string): CommentMessage {
  return {
    id: crypto.randomUUID(),
    author: CommentAuthorSchema.parse(author),
    body: body.trim(),
    createdAt: now,
  };
}

export class LocalCommentsService {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly shared?: SharedCommentsClient;

  constructor(
    private readonly ctxFor: () => MutationContext,
    private readonly storePath?: string,
    cloud?: CloudAuth,
    private readonly publish?: CloudCommentTargets,
  ) {
    if (cloud) {
      this.shared = new SharedCommentsClient(
        () => this.ctxFor().folder.config.folderId,
        cloud,
        () => `${this.path()}.shared`,
      );
    }
  }

  /**
   * Whether this board can take a cloud thread right now, and why not when it
   * can't — the canvas turns each refusal into the matching disabled hint.
   */
  async cloudAvailability(boardId: string): Promise<CloudCommentAvailability> {
    if (!this.shared || !this.publish) return { available: false, reason: "unsupported" };
    const access = await this.publish
      .access()
      .catch(() => ({ state: "signed-out" }) as CanvasCloudAccess);
    if (access.state !== "ready") return { available: false, reason: access.state };
    const slots = await this.publish
      .destinations()
      .then((value) => value.slots)
      .catch(() => []);
    const slot = newestPublishedSlot(slots, boardId);
    if (!slot) return { available: false, reason: "unpublished" };
    return { available: true, slug: slot.slug, url: slot.url };
  }

  private async cloudTarget(boardId: string): Promise<{ slug: string; versionId: string }> {
    if (!this.shared || !this.publish) {
      throw new CommentStoreError("invalid", "This canvas cannot write cloud comments.");
    }
    const access = await this.publish
      .access()
      .catch(() => ({ state: "signed-out" }) as CanvasCloudAccess);
    if (access.state !== "ready") {
      throw new CommentStoreError(
        "invalid",
        access.state === "expired"
          ? "Your velloo-cloud session ended — sign in again to write cloud comments."
          : "Sign in to velloo cloud to write cloud comments.",
      );
    }
    const slots = await this.publish
      .destinations()
      .then((value) => value.slots)
      .catch(() => []);
    const slot = newestPublishedSlot(slots, boardId);
    if (!slot?.latestVersionId) {
      throw new CommentStoreError("invalid", "Publish this board before commenting on the cloud.");
    }
    return { slug: slot.slug, versionId: slot.latestVersionId };
  }

  private path(): string {
    return this.storePath ?? localCommentsPath(folderIdentity(this.ctxFor()));
  }

  private async read(): Promise<LocalCommentsFile> {
    const folderId = folderIdentity(this.ctxFor());
    try {
      const parsed = LocalCommentsFileSchema.parse(JSON.parse(await readFile(this.path(), "utf8")));
      if (parsed.folderId === folderId) return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) {
        throw error;
      }
    }
    return { version: 1, folderId, threads: [] };
  }

  private async write(file: LocalCommentsFile): Promise<void> {
    await writeJsonAtomic(this.path(), LocalCommentsFileSchema.parse(file));
  }

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private validateBoardAndAnchor(boardId: string, anchor?: CommentAnchor): void {
    const folder = this.ctxFor().folder;
    const board = folder.boards.get(boardId);
    if (!board) throw new CommentStoreError("invalid", `No board named ${boardId}.`);
    if (!anchor) return;
    const parsed = CommentAnchorSchema.parse(anchor);
    if (parsed.boardId !== boardId) {
      throw new CommentStoreError("invalid", "The anchor belongs to a different board.");
    }
    if (parsed.kind === "board") return;
    const frame = board.frames.find((candidate) => candidate.id === parsed.frameId);
    if (!frame || frame.screen !== parsed.screenId) {
      throw new CommentStoreError("invalid", "The anchor frame is not on this board or screen.");
    }
    if (!folder.screens.has(parsed.screenId)) {
      throw new CommentStoreError("invalid", `No screen named ${parsed.screenId}.`);
    }
  }

  private view(thread: CommentThread): CommentThreadView {
    const anchor = thread.anchor;
    if (!anchor || anchor.kind === "board") return { ...thread, anchorState: { status: "board" } };
    const folder = this.ctxFor().folder;
    const board = folder.boards.get(thread.boardId);
    const frame = board?.frames.find((candidate) => candidate.id === anchor.frameId);
    const screen = folder.screens.get(anchor.screenId);
    if (!board || !frame || frame.screen !== anchor.screenId || !screen) {
      return { ...thread, anchorState: { status: "stale" } };
    }
    const resolvedPath = resolveLocator(screen.tree, anchor.locator);
    return resolvedPath
      ? { ...thread, anchorState: { status: "attached", resolvedPath } }
      : { ...thread, anchorState: { status: "stale" } };
  }

  private async sharedThreads(): Promise<CommentThread[]> {
    return this.shared ? (await this.shared.refresh()).threads : [];
  }

  async refreshShared(): Promise<SharedRefreshResult | undefined> {
    const result = await this.shared?.refresh();
    if (result?.changed) {
      for (const boardId of result.boardIds) {
        this.ctxFor().broadcast({ type: "comments-changed", boardId, scope: "shared" });
      }
    }
    return result;
  }

  async list(
    boardId: string,
    status: "open" | "resolved" | "all" = "open",
    scope: CommentScopeFilter = "all",
  ): Promise<CommentThreadView[]> {
    if (!this.ctxFor().folder.boards.has(boardId)) {
      throw new CommentStoreError("invalid", `No board named ${boardId}.`);
    }
    const [file, shared] = await Promise.all([this.read(), this.sharedThreads()]);
    return [...file.threads, ...shared]
      .filter(
        (thread) =>
          thread.boardId === boardId &&
          (status === "all" || thread.status === status) &&
          (scope === "all" || thread.scope === scope),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((thread) => this.view(thread));
  }

  async listAll(
    status: "open" | "resolved" | "all" = "open",
    scope: CommentScopeFilter = "all",
  ): Promise<CommentThreadView[]> {
    const [file, shared] = await Promise.all([this.read(), this.sharedThreads()]);
    return [...file.threads, ...shared]
      .filter(
        (thread) =>
          (status === "all" || thread.status === status) &&
          (scope === "all" || thread.scope === scope),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((thread) => this.view(thread));
  }

  countOpenSync(): number {
    const shared =
      this.shared?.cachedSync().filter((thread) => thread.status === "open").length ?? 0;
    try {
      const parsed = LocalCommentsFileSchema.parse(JSON.parse(readFileSync(this.path(), "utf8")));
      const local =
        parsed.folderId === folderIdentity(this.ctxFor())
          ? parsed.threads.filter((thread) => thread.status === "open").length
          : 0;
      return local + shared;
    } catch {
      return shared;
    }
  }

  async get(id: string): Promise<CommentThreadView> {
    const thread = (await this.read()).threads.find((candidate) => candidate.id === id);
    if (thread) return this.view(thread);
    const shared = await this.shared?.get(id);
    if (shared) return this.view(shared);
    throw new CommentStoreError("not-found", "No such comment thread.");
  }

  create(input: CreateLocalCommentInput): Promise<CommentThreadView> {
    return this.serialized(async () => {
      this.validateBoardAndAnchor(input.boardId, input.anchor);
      const body = input.body.trim();
      if (!body) throw new CommentStoreError("invalid", "Comment body is required.");
      const author = CommentAuthorSchema.parse(input.author ?? defaultAuthor());
      if (input.scope === "shared") {
        return this.view(
          await this.createShared(input.boardId, body, input.anchor, ownerAuthorKind(author)),
        );
      }
      const now = new Date().toISOString();
      const file = await this.read();
      const thread = CommentThreadSchema.parse({
        id: crypto.randomUUID(),
        scope: "local",
        folderId: file.folderId,
        boardId: input.boardId,
        ...(input.anchor ? { anchor: input.anchor } : {}),
        origin: { kind: "local" },
        status: "open",
        messages: [message(body, author, now)],
        createdAt: now,
        updatedAt: now,
      });
      file.threads.push(thread);
      await this.write(file);
      this.ctxFor().broadcast({
        type: "comments-changed",
        boardId: thread.boardId,
        scope: "local",
      });
      return this.view(thread);
    });
  }

  reply(id: string, input: ReplyToCommentInput): Promise<CommentThreadView> {
    return this.serialized(async () => {
      const body = input.body.trim();
      if (!body) throw new CommentStoreError("invalid", "Reply body is required.");
      const file = await this.read();
      const index = file.threads.findIndex((candidate) => candidate.id === id);
      if (index < 0) {
        if (!this.shared) throw new CommentStoreError("not-found", "No such comment thread.");
        try {
          const next = await this.shared.reply(id, body, ownerAuthorKind(input.author));
          this.ctxFor().broadcast({
            type: "comments-changed",
            boardId: next.boardId,
            scope: "shared",
          });
          return this.view(next);
        } catch (error) {
          throw new CommentStoreError(
            "invalid",
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      const current = file.threads[index] as CommentThread;
      const now = new Date().toISOString();
      const next = CommentThreadSchema.parse({
        ...current,
        messages: [...current.messages, message(body, input.author ?? defaultAuthor(), now)],
        updatedAt: now,
      });
      file.threads[index] = next;
      await this.write(file);
      this.ctxFor().broadcast({ type: "comments-changed", boardId: next.boardId, scope: "local" });
      return this.view(next);
    });
  }

  setResolved(id: string, resolved: boolean): Promise<CommentThreadView> {
    return this.serialized(async () => {
      const file = await this.read();
      const index = file.threads.findIndex((candidate) => candidate.id === id);
      if (index < 0) {
        if (!this.shared) throw new CommentStoreError("not-found", "No such comment thread.");
        try {
          const next = await this.shared.setResolved(id, resolved);
          this.ctxFor().broadcast({
            type: "comments-changed",
            boardId: next.boardId,
            scope: "shared",
          });
          return this.view(next);
        } catch (error) {
          throw new CommentStoreError(
            "invalid",
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      const current = file.threads[index] as CommentThread;
      const now = new Date().toISOString();
      const next = CommentThreadSchema.parse({
        ...current,
        status: resolved ? "resolved" : "open",
        updatedAt: now,
        ...(resolved ? { resolvedAt: now } : { resolvedAt: undefined }),
      });
      file.threads[index] = next;
      await this.write(file);
      this.ctxFor().broadcast({ type: "comments-changed", boardId: next.boardId, scope: "local" });
      return this.view(next);
    });
  }

  private async createShared(
    boardId: string,
    body: string,
    anchor: CommentAnchor | undefined,
    authorKind: OwnerAuthorKind,
  ): Promise<CommentThread> {
    const shared = this.shared;
    if (!shared) throw new CommentStoreError("invalid", "This canvas cannot write cloud comments.");
    const target = await this.cloudTarget(boardId);
    const thread = await shared
      .create(target.slug, {
        versionId: target.versionId,
        boardId,
        ...(anchor ? { anchor } : {}),
        body,
        authorKind,
      })
      .catch((error: unknown) => {
        throw new CommentStoreError(
          "invalid",
          error instanceof Error ? error.message : String(error),
        );
      });
    this.ctxFor().broadcast({ type: "comments-changed", boardId, scope: "shared" });
    return thread;
  }

  /**
   * Move a local thread onto the board's published link. The conversation is
   * replayed message by message so nothing is lost, then the local copy goes:
   * a thread lives in exactly one place. Each replayed message keeps its own
   * voice, so an exchange between the designer and their agent still reads as
   * one on the other side. What it cannot keep is when each was written —
   * replay stamps the cloud's clock.
   */
  promoteToShared(id: string): Promise<CommentThreadView> {
    return this.serialized(async () => {
      const shared = this.shared;
      if (!shared) {
        throw new CommentStoreError("invalid", "This canvas cannot write cloud comments.");
      }
      const file = await this.read();
      const index = file.threads.findIndex((candidate) => candidate.id === id);
      if (index < 0) {
        if (await this.shared?.get(id)) {
          throw new CommentStoreError("invalid", "This thread is already a cloud thread.");
        }
        throw new CommentStoreError("not-found", "No such comment thread.");
      }
      const local = file.threads[index] as CommentThread;
      const [first, ...rest] = local.messages;
      if (!first) throw new CommentStoreError("invalid", "That thread has no messages to move.");
      let promoted = await this.createShared(
        local.boardId,
        first.body,
        local.anchor,
        ownerAuthorKind(first.author),
      );
      try {
        for (const message of rest) {
          promoted = await shared.reply(promoted.id, message.body, ownerAuthorKind(message.author));
        }
        if (local.status === "resolved") {
          promoted = await shared.setResolved(promoted.id, true);
        }
      } catch (error) {
        throw new CommentStoreError(
          "invalid",
          `The thread moved to the cloud but its replies did not: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      // Re-read: the cloud round-trips above ran outside this file's snapshot.
      const latest = await this.read();
      latest.threads = latest.threads.filter((candidate) => candidate.id !== id);
      await this.write(latest);
      this.ctxFor().broadcast({
        type: "comments-changed",
        boardId: local.boardId,
        scope: "local",
      });
      return this.view(promoted);
    });
  }

  delete(id: string): Promise<{ removedId: string; boardId: string }> {
    return this.serialized(async () => {
      const file = await this.read();
      const index = file.threads.findIndex((candidate) => candidate.id === id);
      if (index < 0) {
        if (await this.shared?.get(id)) {
          throw new CommentStoreError(
            "invalid",
            "Shared comment threads cannot be deleted. Resolve the conversation instead.",
          );
        }
        throw new CommentStoreError("not-found", "No such comment thread.");
      }
      const [removed] = file.threads.splice(index, 1);
      if (!removed) throw new CommentStoreError("not-found", "No such comment thread.");
      await this.write(file);
      this.ctxFor().broadcast({
        type: "comments-changed",
        boardId: removed.boardId,
        scope: "local",
      });
      return { removedId: id, boardId: removed.boardId };
    });
  }
}
