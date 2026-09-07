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
  | { kind: "snippet"; snippetId: string };

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
  const res = await fetch("/api/undo", { method: "POST" });
  if (!res.ok) throw new Error(`undo: ${res.status}`);
  return (await res.json()) as HistoryResponse;
}

export async function redo(): Promise<HistoryResponse> {
  ensureConnected();
  const res = await fetch("/api/undo/redo", { method: "POST" });
  if (!res.ok) throw new Error(`redo: ${res.status}`);
  return (await res.json()) as HistoryResponse;
}
