import { getJson } from "./discovery.ts";

/**
 * GET /api/search — the Ctrl+K dialog's data source. Shapes hand-mirror the
 * server's search.ts result types, same as DesignSummary mirrors /api/design.
 */

export interface SearchBoardHit {
  id: string;
  name: string;
  frameCount: number;
}

export interface SearchScreenHit {
  id: string;
  name: string;
  /** Boards with a frame showing this screen, in sidebar order. */
  boards: { id: string; name: string }[];
}

export interface SearchTextHit {
  screenId: string;
  screenName: string;
  /** First board (sidebar order) with a frame showing the screen. */
  board: { id: string; name: string } | null;
  path: number[];
  kind: "component" | "snippet";
  ref: string;
  nodeId?: string;
  /** The prop (or snippet arg) whose value matched. */
  prop: string;
  excerpt: string;
  /** First match range within `excerpt`. */
  matchStart: number;
  matchEnd: number;
}

export interface SearchResponse {
  query: string;
  boards: SearchBoardHit[];
  screens: SearchScreenHit[];
  text: SearchTextHit[];
  textTotal: number;
}

export function fetchSearch(q: string): Promise<SearchResponse> {
  return getJson(`/api/search?q=${encodeURIComponent(q)}`, "fetchSearch");
}
