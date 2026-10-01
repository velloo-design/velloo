import { ensureConnected } from "./connection.ts";

export interface HistoryDepths {
  undo: number;
  redo: number;
}

type RevertedEntry =
  | { kind: "screen"; screenId: string }
  | { kind: "board"; boardId: string }
  /** One act that wrote several boards, e.g. a frame moved between two. */
  | { kind: "boards"; boardIds: string[] }
  | { kind: "theme"; themeName: string }
  | { kind: "snippet"; snippetId: string }
  | { kind: "notes"; boardId: string };

export interface HistoryResponse extends HistoryDepths {
  reverted: RevertedEntry | null;
}

export async function fetchHistory(): Promise<HistoryDepths> {
  const res = await fetch("/api/undo");
  if (!res.ok) throw new Error(`fetchHistory: ${res.status}`);
  return (await res.json()) as HistoryDepths;
}

export async function undo(): Promise<HistoryResponse> {
  ensureConnected();
  return step(await fetch("/api/undo", { method: "POST" }), "undo");
}

export async function redo(): Promise<HistoryResponse> {
  ensureConnected();
  return step(await fetch("/api/undo/redo", { method: "POST" }), "redo");
}

/**
 * A 409 is the daemon refusing a step an agent has since rewritten — its
 * message says so, and is what the person should read.
 */
async function step(res: Response, what: string): Promise<HistoryResponse> {
  if (res.status === 409) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Can't ${what}: it has been changed since.`);
  }
  if (!res.ok) throw new Error(`${what}: ${res.status}`);
  return (await res.json()) as HistoryResponse;
}
