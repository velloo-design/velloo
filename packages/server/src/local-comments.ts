import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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
import type { CloudAuth } from "./cloud.ts";
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
  anchor?: CommentAnchor;
  author?: CommentAuthor;
}

export interface ReplyToCommentInput {
  body: string;
  author?: CommentAuthor;
}

const defaultAuthor = (): CommentAuthor => ({ kind: "user" });

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
  ) {
    if (cloud) {
      this.shared = new SharedCommentsClient(
        () => this.ctxFor().folder.config.folderId,
        cloud,
        () => `${this.path()}.shared`,
      );
    }
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
  ): Promise<CommentThreadView[]> {
    if (!this.ctxFor().folder.boards.has(boardId)) {
      throw new CommentStoreError("invalid", `No board named ${boardId}.`);
    }
    const [file, shared] = await Promise.all([this.read(), this.sharedThreads()]);
    return [...file.threads, ...shared]
      .filter(
        (thread) => thread.boardId === boardId && (status === "all" || thread.status === status),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((thread) => this.view(thread));
  }

  async listAll(
    status: "open" | "resolved" | "all" = "open",
    requestedOnly = false,
  ): Promise<CommentThreadView[]> {
    const [file, shared] = await Promise.all([this.read(), this.sharedThreads()]);
    return [...file.threads, ...shared]
      .filter(
        (thread) =>
          (status === "all" || thread.status === status) &&
          (!requestedOnly || thread.scope === "shared" || thread.agentRequestedAt !== undefined),
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
          const next = await this.shared.reply(id, body);
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
        ...(resolved
          ? { resolvedAt: now, agentRequestedAt: undefined }
          : { resolvedAt: undefined }),
      });
      file.threads[index] = next;
      await this.write(file);
      this.ctxFor().broadcast({ type: "comments-changed", boardId: next.boardId, scope: "local" });
      return this.view(next);
    });
  }

  setAgentRequested(id: string, requested: boolean): Promise<CommentThreadView> {
    return this.serialized(async () => {
      const file = await this.read();
      const index = file.threads.findIndex((candidate) => candidate.id === id);
      if (index < 0) {
        const shared = await this.shared?.get(id);
        if (shared) return this.view(shared);
        throw new CommentStoreError("not-found", "No such comment thread.");
      }
      const current = file.threads[index] as CommentThread;
      if (current.status === "resolved" && requested) {
        throw new CommentStoreError("invalid", "Reopen the thread before asking the agent.");
      }
      const now = new Date().toISOString();
      const next = CommentThreadSchema.parse({
        ...current,
        agentRequestedAt: requested ? now : undefined,
        updatedAt: now,
      });
      file.threads[index] = next;
      await this.write(file);
      this.ctxFor().broadcast({
        type: "comments-changed",
        boardId: next.boardId,
        scope: "local",
      });
      return this.view(next);
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
