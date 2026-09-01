import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Annotation, Node } from "@velloo/schema";
import { type CloudAuth, currentToken } from "./cloud.ts";
import type { DesignFolder } from "./design-folder.ts";
import { writeJsonAtomic } from "./fs.ts";
import { newAnnotationId } from "./mutations/annotations.ts";
import { withScreenLock } from "./mutations/context.ts";
import { persistAnnotations } from "./mutations/persist.ts";
import { pathAt, pathFromString } from "./path.ts";
import type { WatchEvent } from "./watcher.ts";

/**
 * Share-link comments → local annotations, pull-only: the cloud
 * NEVER writes into the repo — this module fetches comments left on the
 * folder's published links and converts them locally into annotations via the
 * existing mutation/persist path. Resolution round-trips: deleting a pulled
 * annotation locally PATCHes the comment resolved on the next pull; a comment
 * resolved in the cloud UI removes its local annotation.
 *
 * Persistence:
 *  - The durable folder↔link association lives in the CLOUD, keyed by the
 *    folder's `config.folderId`: `velloo publish` stamps it on the
 *    link, and the pull passes it so the server resolves the folder's links —
 *    any clone of the folder syncs comments with no local link state at all.
 *  - `.design/cache/comments.json` — machine-local sync state: the `since`
 *    cursor plus the commentId ↔ annotationId map. Losing it never duplicates
 *    annotations (each pulled annotation carries `cloud.commentId`, which the
 *    pull re-adopts), it only forgets pre-wipe local deletions.
 *
 * Everything here is offline-tolerant by construction: logged out, never
 * published, or an unreachable cloud are quiet no-ops with a summary status.
 */

// ── Sync state (.design/cache/comments.json) ────────────────────────────────

interface CommentMapping {
  annotationId: string;
  screenId: string;
  /** True once resolution is settled on both sides — no more work for this comment. */
  resolved: boolean;
}

interface CommentSyncState {
  version: 1;
  /** The cloud's `now` from the last pull — passed back as `?since=`. */
  since?: string;
  /**
   * The folder's link slugs as of the last pull. A slug the cloud returns
   * that isn't here (a link published from another clone) forces one full
   * re-pull, since its comments may predate the cursor.
   */
  slugs: string[];
  comments: Record<string, CommentMapping>;
}

const statePath = (root: string) => join(root, ".design", "cache", "comments.json");

async function readState(root: string): Promise<CommentSyncState> {
  try {
    const raw = JSON.parse(await readFile(statePath(root), "utf8")) as CommentSyncState;
    if (raw.version === 1 && raw.comments) {
      return { ...raw, slugs: Array.isArray(raw.slugs) ? raw.slugs : [] };
    }
  } catch {
    // missing or corrupt — full pull; cloud.commentId adoption keeps it idempotent
  }
  return { version: 1, slugs: [], comments: {} };
}

// ── The pull ─────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 10_000;

interface CloudComment {
  id: string;
  slug: string;
  screenId: string;
  nodePath?: string | null;
  author?: string | null;
  body: string;
  resolved: boolean;
}

type LinkStatus = "ok" | "revoked" | "unknown";

interface CommentsResponse {
  comments?: CloudComment[];
  links?: Record<string, LinkStatus>;
  now?: string;
}

/**
 * Structural subset of MutationContext — everything the sync needs. Keeps the
 * pull callable from anywhere that has the folder + broadcaster (server boot,
 * the MCP tool, tests) without a full provider setup.
 */
export interface CommentSyncContext {
  folder: DesignFolder;
  broadcast: (e: WatchEvent) => void;
}

export interface PullCommentsSummary {
  status: "ok" | "logged-out" | "no-links" | "error";
  /** New unresolved comments landed as annotations. */
  pulled: number;
  /** Locally-resolved (deleted) annotations whose comments we PATCHed resolved. */
  resolvedUp: number;
  /** Cloud-resolved comments whose local annotations we removed. */
  resolvedDown: number;
  /**
   * Pulled comments still waiting locally as annotations, whole folder —
   * `countUnresolvedPulledComments` after this pull. The same count the MCP
   * instructions surface at initialize. Reported even on the no-network
   * statuses (it derives from local state alone).
   */
  unresolvedTotal: number;
  /** Per-slug link status from the cloud (`ok` | `revoked` | `unknown`). */
  links: Record<string, LinkStatus>;
  /** Human-readable note — revoked links, the skip reason, or the error cause. */
  note?: string;
}

/**
 * Pulled share-link comments still waiting to be read, derived purely from
 * local state: an annotation carrying `cloud.commentId` exists exactly while
 * its comment is unresolved on both sides — a cloud-side resolve removes it on
 * the next pull, a local delete removes it immediately (the pending PATCH-up
 * is tracked in the mapping cache, not here). `folder.annotations` mirrors the
 * on-disk sidecars (mutations, pulls, and the watcher all keep it fresh), so
 * this is synchronous and never touches the network — safe on the MCP
 * initialize path. Staleness: only as fresh as the daemon's last pull (boot +
 * the interval).
 */
export function countUnresolvedPulledComments(folder: DesignFolder): number {
  let count = 0;
  for (const annotations of folder.annotations.values()) {
    for (const a of annotations) if (a.cloud?.commentId) count += 1;
  }
  return count;
}

const inFlight = new Map<string, Promise<PullCommentsSummary>>();

/** One pull at a time per folder — the boot pull, the interval, and the MCP tool coalesce. */
export function pullComments(
  ctx: CommentSyncContext,
  cloud: CloudAuth,
): Promise<PullCommentsSummary> {
  const key = ctx.folder.root;
  const running = inFlight.get(key);
  if (running) return running;
  const run = doPull(ctx, cloud).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

async function doPull(ctx: CommentSyncContext, cloud: CloudAuth): Promise<PullCommentsSummary> {
  const root = ctx.folder.root;
  // Recomputed per return: local state may have changed by the time an OK
  // pull finishes persisting.
  const zero = () => ({
    pulled: 0,
    resolvedUp: 0,
    resolvedDown: 0,
    unresolvedTotal: countUnresolvedPulledComments(ctx.folder),
    links: {} as Record<string, LinkStatus>,
  });

  // The folder's cloud identity resolves its links server-side — no local
  // link records. A folder without one has never been published.
  const folderId = ctx.folder.config.folderId;
  if (!folderId) {
    return {
      status: "no-links",
      ...zero(),
      note: "This folder has never been published — `velloo publish` assigns its cloud id and creates a share link.",
    };
  }
  const token = await currentToken(cloud);
  if (!token) {
    return {
      status: "logged-out",
      ...zero(),
      note: "Not signed in to velloo-cloud — run `velloo login` to sync share-link comments.",
    };
  }

  const state = await readState(root);

  const fetchComments = async (
    sinceParam: string | undefined,
  ): Promise<{ payload: CommentsResponse } | { fail: string }> => {
    const query = new URLSearchParams({ folderId });
    if (sinceParam) query.set("since", sinceParam);
    const res = await fetch(`${cloud.url}/v1/comments?${query}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { fail: `comment fetch failed (${res.status})` };
    return { payload: (await res.json()) as CommentsResponse };
  };

  let payload: CommentsResponse;
  try {
    const first = await fetchComments(state.since);
    if ("fail" in first) return { status: "error", ...zero(), note: first.fail };
    payload = first.payload;
    // The cloud can surface links this machine has never seen (published from
    // another clone) whose comments predate the cursor — one full re-pull
    // picks them up. A failed re-pull keeps the incremental payload; the next
    // cycle retries because the new slugs land in state.slugs only on success.
    if (state.since && Object.keys(payload.links ?? {}).some((s) => !state.slugs.includes(s))) {
      const full = await fetchComments(undefined);
      if ("fail" in full) return { status: "error", ...zero(), note: full.fail };
      payload = full.payload;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", ...zero(), note: `couldn't reach velloo-cloud (${msg})` };
  }

  const map: Record<string, CommentMapping> = { ...state.comments };
  const annotationsOf = (screenId: string) => ctx.folder.annotations.get(screenId) ?? [];
  const hasAnnotation = (m: CommentMapping) =>
    annotationsOf(m.screenId).some((a) => a.id === m.annotationId);

  // ── Down: land new comments; remove annotations for cloud-resolved ones ──
  let pulled = 0;
  let resolvedDown = 0;
  const adds = new Map<string, Annotation[]>();
  const removes = new Map<string, Set<string>>();

  for (const c of payload.comments ?? []) {
    if (!c || typeof c.id !== "string" || typeof c.screenId !== "string") continue;
    let entry = map[c.id];
    if (!entry) {
      // Cross-machine idempotency: an annotation from another machine's pull
      // (or a pre-wipe state) already carries this comment id — adopt it.
      const adopted = annotationsOf(c.screenId).find((a) => a.cloud?.commentId === c.id);
      if (adopted) {
        entry = { annotationId: adopted.id, screenId: c.screenId, resolved: false };
        map[c.id] = entry;
      }
    }
    if (entry) {
      if (c.resolved && !entry.resolved) {
        if (hasAnnotation(entry)) {
          let ids = removes.get(entry.screenId);
          if (!ids) {
            ids = new Set();
            removes.set(entry.screenId, ids);
          }
          ids.add(entry.annotationId);
          resolvedDown += 1;
        }
        entry.resolved = true;
      }
      continue;
    }
    // Unmapped: only new UNRESOLVED comments land; a resolved one we never saw
    // has nothing to show or track.
    if (c.resolved) continue;
    const screen = ctx.folder.screens.get(c.screenId);
    if (!screen) continue; // published screen no longer exists locally
    const annotation: Annotation = {
      id: newAnnotationId(),
      target: { locator: locatorFor(screen.tree, c.nodePath) },
      position: "auto",
      body: withProvenance(c),
      author: "user",
      cloud: { commentId: c.id, slug: c.slug, ...(c.author ? { author: c.author } : {}) },
    };
    let list = adds.get(c.screenId);
    if (!list) {
      list = [];
      adds.set(c.screenId, list);
    }
    list.push(annotation);
    map[c.id] = { annotationId: annotation.id, screenId: c.screenId, resolved: false };
    pulled += 1;
  }

  for (const screenId of new Set([...adds.keys(), ...removes.keys()])) {
    await withScreenLock(ctx.folder, screenId, async () => {
      const current = ctx.folder.annotations.get(screenId) ?? [];
      const drop = removes.get(screenId);
      const next = [
        ...(drop ? current.filter((a) => !drop.has(a.id)) : current),
        ...(adds.get(screenId) ?? []),
      ];
      await persistAnnotations(ctx.folder, screenId, next);
    });
    ctx.broadcast({ type: "annotations-changed", screenId });
  }

  // ── Up: a mapped annotation deleted locally means "resolved" — PATCH it. ──
  let resolvedUp = 0;
  for (const [commentId, entry] of Object.entries(map)) {
    if (entry.resolved || hasAnnotation(entry)) continue;
    try {
      const res = await fetch(`${cloud.url}/v1/comments/${encodeURIComponent(commentId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ resolved: true }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        entry.resolved = true;
        resolvedUp += 1;
      } else if (res.status === 404 || res.status === 410) {
        entry.resolved = true; // comment gone in the cloud — stop retrying
      }
    } catch {
      // offline mid-pull — retry on the next cycle
    }
  }

  const nextSince = payload.now ?? state.since;
  await writeJsonAtomic(statePath(root), {
    version: 1,
    ...(nextSince ? { since: nextSince } : {}),
    slugs: Object.keys(payload.links ?? {}),
    comments: map,
  } satisfies CommentSyncState);

  const linkStatuses = payload.links ?? {};
  const revoked = Object.keys(linkStatuses).filter((slug) => linkStatuses[slug] === "revoked");
  return {
    status: "ok",
    pulled,
    resolvedUp,
    resolvedDown,
    unresolvedTotal: countUnresolvedPulledComments(ctx.folder),
    links: linkStatuses,
    ...(revoked.length > 0
      ? {
          note: `Revoked share link${revoked.length > 1 ? "s" : ""}: ${revoked.join(", ")} — comments no longer sync there.`,
        }
      : {}),
  };
}

/**
 * A comment's `nodePath` is the dotted `data-node-path` form ("0.2.1"). A
 * path that no longer resolves (the tree changed since the publish) — or no
 * path at all — anchors at the screen root instead of being dropped.
 */
function locatorFor(tree: Node, nodePath: string | null | undefined): number[] {
  if (!nodePath) return [];
  let path: number[];
  try {
    path = pathFromString(nodePath);
  } catch {
    return [];
  }
  return pathAt(tree, path) ? path : [];
}

function withProvenance(c: CloudComment): string {
  const who = c.author?.trim() || "a reviewer";
  return `${c.body}\n\n— ${who}, via share link \`${c.slug}\``;
}
