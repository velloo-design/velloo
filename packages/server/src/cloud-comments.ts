import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isCloudErrorCode } from "@velloo/protocol/cloud-codes";
import type { OwnerAuthorKind } from "@velloo/protocol/comments";
import type { CommentAnchor } from "@velloo/schema";
import { type CommentThread, CommentThreadSchema } from "@velloo/schema";
import { z } from "zod";
import { type CloudAuth, currentToken } from "./cloud.ts";
import { writeJsonAtomic } from "./fs.ts";

const SharedCacheSchema = z.object({
  version: z.literal(1),
  folderId: z.string().min(1),
  threads: z.array(CommentThreadSchema),
  links: z.record(z.string(), z.enum(["ok", "revoked"])),
  refreshedAt: z.iso.datetime(),
});

const OwnerFeedSchema = z.object({
  threads: z.array(CommentThreadSchema),
  links: z.record(z.string(), z.enum(["ok", "revoked"])),
  now: z.iso.datetime(),
});

export interface SharedRefreshResult {
  status: "ok" | "logged-out" | "unpublished" | "offline";
  changed: boolean;
  boardIds: string[];
  threads: CommentThread[];
}

const FETCH_TIMEOUT_MS = 10_000;

/** The cloud explains its refusals; pass that through rather than a bare status. */
async function cloudFailure(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => undefined);
  if (body && typeof body === "object" && "message" in body) {
    const { message, error } = body as { message?: unknown; error?: unknown };
    if (typeof message === "string" && message) {
      return isCloudErrorCode(error) ? `${message} (${error})` : message;
    }
  }
  return `Cloud comment request failed (${response.status}).`;
}

function signature(threads: CommentThread[]): string {
  return threads
    .map((thread) => `${thread.id}:${thread.updatedAt}:${thread.status}:${thread.messages.length}`)
    .sort()
    .join("|");
}

/** Cloud-owned conversations projected to durable machine state, never repo files. */
export class SharedCommentsClient {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly folderId: () => string | undefined,
    private readonly cloud: CloudAuth,
    private readonly cachePath: () => string,
  ) {}

  private async cached(): Promise<CommentThread[]> {
    const id = this.folderId();
    if (!id) return [];
    try {
      const parsed = SharedCacheSchema.parse(JSON.parse(await readFile(this.cachePath(), "utf8")));
      return parsed.folderId === id ? parsed.threads : [];
    } catch {
      return [];
    }
  }

  cachedSync(): CommentThread[] {
    const id = this.folderId();
    if (!id) return [];
    try {
      const parsed = SharedCacheSchema.parse(JSON.parse(readFileSync(this.cachePath(), "utf8")));
      return parsed.folderId === id ? parsed.threads : [];
    } catch {
      return [];
    }
  }

  refresh(): Promise<SharedRefreshResult> {
    const run = this.tail.then(
      () => this.doRefresh(),
      () => this.doRefresh(),
    );
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async doRefresh(): Promise<SharedRefreshResult> {
    const folderId = this.folderId();
    const before = await this.cached();
    if (!folderId) {
      return { status: "unpublished", changed: false, boardIds: [], threads: before };
    }
    const token = await currentToken(this.cloud);
    if (!token) return { status: "logged-out", changed: false, boardIds: [], threads: before };
    try {
      const query = new URLSearchParams({ folderId, status: "all" });
      const response = await fetch(`${this.cloud.url}/v1/comment-threads?${query}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`shared comment fetch failed (${response.status})`);
      const payload = OwnerFeedSchema.parse(await response.json());
      const changed = signature(before) !== signature(payload.threads);
      await writeJsonAtomic(this.cachePath(), {
        version: 1,
        folderId,
        threads: payload.threads,
        links: payload.links,
        refreshedAt: payload.now,
      });
      const boardIds = changed
        ? [...new Set([...before, ...payload.threads].map((thread) => thread.boardId))]
        : [];
      return { status: "ok", changed, boardIds, threads: payload.threads };
    } catch {
      return { status: "offline", changed: false, boardIds: [], threads: before };
    }
  }

  async get(id: string): Promise<CommentThread | undefined> {
    return (await this.refresh()).threads.find((thread) => thread.id === id);
  }

  private async mutate(path: string, init: RequestInit): Promise<CommentThread> {
    const token = await currentToken(this.cloud);
    if (!token) throw new Error("Sign in to write shared comments.");
    const response = await fetch(`${this.cloud.url}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(await cloudFailure(response));
    const parsed = z.object({ thread: CommentThreadSchema }).parse(await response.json());
    await this.refresh();
    return parsed.thread;
  }

  /**
   * Author a thread on a published link as the account that owns it. The
   * version is the link's latest: a cloud thread hangs off the published
   * design a reviewer would see, not the working folder state.
   *
   * `authorKind` says which owner-side voice wrote it. The cloud cannot infer
   * it — the designer and their agent share one account — so a reviewer who
   * sees the reply depends on us declaring it honestly.
   */
  create(
    slug: string,
    input: {
      versionId: string;
      boardId: string;
      anchor?: CommentAnchor;
      body: string;
      authorKind: OwnerAuthorKind;
    },
  ): Promise<CommentThread> {
    return this.mutate(`/v1/links/${encodeURIComponent(slug)}/comment-threads`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  reply(id: string, body: string, authorKind: OwnerAuthorKind): Promise<CommentThread> {
    return this.mutate(`/v1/comment-threads/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, authorKind }),
    });
  }

  setResolved(id: string, resolved: boolean): Promise<CommentThread> {
    return this.mutate(`/v1/comment-threads/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ resolved }),
    });
  }

  /**
   * Take back one message. The cloud checks the account behind the token
   * wrote it — a reviewer's message isn't ours to remove — and answers with
   * the thread carrying a tombstone where the body was.
   */
  deleteMessage(id: string, messageId: string): Promise<CommentThread> {
    const path = `/v1/comment-threads/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`;
    return this.mutate(path, { method: "DELETE" });
  }
}
