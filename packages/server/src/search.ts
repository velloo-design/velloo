import { isArchived, isComponentNode, isSnippetInstance, type Node, nodeId } from "@velloo/schema";
import { type DesignFolder, orderedBoards } from "./design-folder.ts";

/**
 * Folder-wide search backing the canvas's Ctrl+K dialog: board names,
 * screen names, and user-visible text inside screen trees. Everything is
 * already resident in the DesignFolder maps, so this is a plain walk —
 * no index, recomputed per query.
 */

/**
 * String props that carry user-visible text. `className` (and any other
 * styling/config strings) stay out — matching them would drown text results
 * in utility-class noise.
 */
const TEXT_PROPS = ["children", "label", "placeholder", "title", "alt"] as const;

/** Max chars of context returned around a text match. */
const EXCERPT_WINDOW = 120;

export interface BoardHit {
  id: string;
  name: string;
  frameCount: number;
  /** Archived boards still match — search is how you find something you parked. */
  archived: boolean;
}

export interface ScreenHit {
  id: string;
  name: string;
  /** Boards with a frame showing this screen, in sidebar order (archived last). */
  boards: { id: string; name: string; archived: boolean }[];
}

export interface TextHit {
  screenId: string;
  screenName: string;
  /** First board (sidebar order, live before archived) showing the screen. */
  board: { id: string; name: string; archived: boolean } | null;
  path: number[];
  kind: "component" | "snippet";
  /** Component `$ref`, or the snippet id for snippet-instance arg matches. */
  ref: string;
  nodeId?: string;
  /** The prop (or snippet arg) whose value matched. */
  prop: string;
  /** Match context, ellipsized to ~{@link EXCERPT_WINDOW} chars. */
  excerpt: string;
  /** First match range within `excerpt`, for client-side highlighting. */
  matchStart: number;
  matchEnd: number;
}

export interface SearchResult {
  query: string;
  boards: BoardHit[];
  screens: ScreenHit[];
  text: TextHit[];
  /** Total text matches before the limit was applied. */
  textTotal: number;
}

export function emptySearchResult(query: string): SearchResult {
  return { query, boards: [], screens: [], text: [], textTotal: 0 };
}

/**
 * Prefix matches sort ahead of mid-string matches; ties keep folder order.
 * Archived boards sink below every live hit — present, but never in the way.
 */
function nameRank(name: string, id: string, q: string, archived = false): number {
  const prefix = name.toLowerCase().startsWith(q) || id.toLowerCase().startsWith(q) ? 0 : 1;
  return (archived ? 2 : 0) + prefix;
}

function nameMatches(name: string, id: string, q: string): boolean {
  return name.toLowerCase().includes(q) || id.toLowerCase().includes(q);
}

function excerptAround(
  value: string,
  index: number,
  queryLength: number,
): Pick<TextHit, "excerpt" | "matchStart" | "matchEnd"> {
  if (value.length <= EXCERPT_WINDOW) {
    return { excerpt: value, matchStart: index, matchEnd: index + queryLength };
  }
  const lead = 40;
  const start = Math.max(0, index - lead);
  const end = Math.min(value.length, start + EXCERPT_WINDOW);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < value.length ? "…" : "";
  const excerpt = prefix + value.slice(start, end) + suffix;
  const matchStart = prefix.length + (index - start);
  return { excerpt, matchStart, matchEnd: Math.min(excerpt.length, matchStart + queryLength) };
}

export function searchFolder(folder: DesignFolder, rawQuery: string, textLimit = 20): SearchResult {
  const query = rawQuery.trim();
  const q = query.toLowerCase();
  if (q === "") return emptySearchResult(query);

  const boardsInOrder = orderedBoards(folder);

  const boards: BoardHit[] = boardsInOrder
    .filter(([id, b]) => nameMatches(b.name, id, q))
    .map(([id, b]) => ({
      id,
      name: b.name,
      frameCount: b.frames.length,
      archived: isArchived(b),
    }))
    .sort((a, b) => nameRank(a.name, a.id, q, a.archived) - nameRank(b.name, b.id, q, b.archived));

  // screen id → hosting boards, in sidebar order (drives both the screen
  // hits' board chips and the text hits' navigation target).
  const hostBoards = new Map<string, { id: string; name: string; archived: boolean }[]>();
  for (const [boardId, board] of boardsInOrder) {
    for (const frame of board.frames) {
      const hosts = hostBoards.get(frame.screen) ?? [];
      if (!hosts.some((h) => h.id === boardId)) {
        hosts.push({ id: boardId, name: board.name, archived: isArchived(board) });
      }
      hostBoards.set(frame.screen, hosts);
    }
  }
  // Live hosts first, so a text hit's navigation target (hosts[0]) never
  // lands on an archived board while a live one shows the same screen.
  for (const hosts of hostBoards.values()) {
    hosts.sort((a, b) => Number(a.archived) - Number(b.archived));
  }

  const screens: ScreenHit[] = [...folder.screens.entries()]
    .filter(([id, s]) => nameMatches(s.name, id, q))
    .map(([id, s]) => ({ id, name: s.name, boards: hostBoards.get(id) ?? [] }))
    .sort((a, b) => nameRank(a.name, a.id, q) - nameRank(b.name, b.id, q));

  const text: TextHit[] = [];
  let textTotal = 0;

  function consider(
    screenId: string,
    screenName: string,
    node: Node,
    path: number[],
    prop: string,
    value: string,
  ): boolean {
    const index = value.toLowerCase().indexOf(q);
    if (index === -1) return false;
    textTotal += 1;
    if (text.length < textLimit) {
      const isSnippet = isSnippetInstance(node);
      text.push({
        screenId,
        screenName,
        board: hostBoards.get(screenId)?.[0] ?? null,
        path,
        kind: isSnippet ? "snippet" : "component",
        ref: isSnippet ? node.$snippet : isComponentNode(node) ? node.$ref : "",
        ...(nodeId(node) ? { nodeId: nodeId(node) } : {}),
        prop,
        ...excerptAround(value, index, q.length),
      });
    }
    return true;
  }

  function walk(screenId: string, screenName: string, node: Node, path: number[]): void {
    if (isComponentNode(node)) {
      const props = node.props ?? {};
      for (const prop of TEXT_PROPS) {
        const value = props[prop];
        // One hit per node: the first matching prop stands for it.
        if (typeof value === "string" && consider(screenId, screenName, node, path, prop, value)) {
          break;
        }
      }
      node.children?.forEach((child, i) => {
        walk(screenId, screenName, child, [...path, i]);
      });
      return;
    }
    if (isSnippetInstance(node)) {
      for (const [arg, value] of Object.entries(node.args ?? {})) {
        if (typeof value === "string" && consider(screenId, screenName, node, path, arg, value)) {
          break;
        }
      }
    }
  }

  for (const [screenId, screen] of folder.screens) {
    walk(screenId, screen.name, screen.tree, []);
  }

  return { query, boards, screens, text, textTotal };
}
