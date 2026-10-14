import { isComponentNode, type Node } from "@velloo/schema";
import { agentSession } from "./activity.ts";
import type { DesignFolder } from "./design-folder.ts";
import { pathAt, pathToString } from "./path.ts";

/**
 * What each agent session last knew of each screen: the tree it was handed by
 * a read, or left behind by its own write. A replace is written from that
 * knowledge, so when the screen has moved on without the agent — a person's
 * edit on the canvas, a hand edit on disk, another session — writing it would
 * quietly put back what the agent saw and lose the rest. Agent writes are kept
 * off the canvas's undo stack, so the person could not get theirs back either.
 *
 * Kept per folder (a design switch starts fresh) and in memory only: a session
 * that reconnects has read nothing, and its first replace is let through.
 */
const known = new WeakMap<DesignFolder, Map<string, Map<string, Node>>>();

/** Sessions remembered per folder; the oldest is forgotten past this. */
const SESSION_CAP = 32;

function sessionsOf(folder: DesignFolder): Map<string, Map<string, Node>> {
  let sessions = known.get(folder);
  if (!sessions) {
    sessions = new Map();
    known.set(folder, sessions);
  }
  return sessions;
}

function screensOf(folder: DesignFolder, session: string): Map<string, Node> {
  const sessions = sessionsOf(folder);
  let screens = sessions.get(session);
  if (screens) {
    sessions.delete(session);
  } else {
    screens = new Map();
    if (sessions.size >= SESSION_CAP) sessions.delete(sessions.keys().next().value as string);
  }
  sessions.set(session, screens);
  return screens;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The agent making this request is being shown `tree` as `screenId`'s. */
export function noteScreenRead(folder: DesignFolder, screenId: string, tree: Node): void {
  const session = agentSession();
  if (session === null) return;
  screensOf(folder, session).set(screenId, tree);
}

/**
 * A screen is being written. The writing agent's knowledge follows its own
 * write only while it was current: an agent that missed someone's edit still
 * missed it after an `update_props` of its own.
 */
export function noteScreenWrite(
  folder: DesignFolder,
  screenId: string,
  prev: Node | undefined,
  next: Node,
): void {
  const session = agentSession();
  if (session === null) return;
  const screens = screensOf(folder, session);
  const knew = screens.get(screenId);
  if (knew === undefined || prev === undefined || same(knew, prev)) screens.set(screenId, next);
}

/**
 * The nodes a replace of `target` (a resolved path in the current tree) would
 * undo, or null when the requesting agent's knowledge of what it replaces is
 * current. Only the replaced subtree counts: someone's edit elsewhere on the
 * screen survives a node replace, so it is no reason to refuse one.
 */
export function staleUnder(
  folder: DesignFolder,
  screenId: string,
  target: number[],
): string[] | null {
  const session = agentSession();
  if (session === null) return null;
  const knew = sessionsOf(folder).get(session)?.get(screenId);
  const now = folder.screens.get(screenId)?.tree;
  if (knew === undefined || now === undefined) return null;
  const current = pathAt(now, target);
  if (current === null) return null;
  const id = isComponentNode(current) ? current.$id : undefined;
  const before = id === undefined ? pathAt(knew, target) : findWithId(knew, id);
  if (before !== null && same(before, current)) return null;
  return changedNodes(before, current, target);
}

function findWithId(root: Node, id: string): Node | null {
  if (isComponentNode(root)) {
    if (root.$id === id) return root;
    for (const child of root.children ?? []) {
      const found = findWithId(child, id);
      if (found) return found;
    }
  }
  return null;
}

/** Each node's own fields (children reduced to their labels), by label. */
function flatten(node: Node | null, path: number[], into: Map<string, string>): void {
  if (node === null) return;
  const label = (n: Node, p: number[]) =>
    isComponentNode(n) && n.$id ? `@${n.$id}` : pathToString(p);
  if (!isComponentNode(node)) {
    into.set(label(node, path), JSON.stringify(node));
    return;
  }
  const children = node.children ?? [];
  into.set(
    label(node, path),
    JSON.stringify({ ...node, children: children.map((c, i) => label(c, [...path, i])) }),
  );
  children.forEach((child, i) => {
    flatten(child, [...path, i], into);
  });
}

const CHANGED_CAP = 12;

function changedNodes(before: Node | null, after: Node, at: number[]): string[] {
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  flatten(before, at, a);
  flatten(after, at, b);
  const changed = [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k));
  return changed.length > CHANGED_CAP
    ? [...changed.slice(0, CHANGED_CAP), `…and ${changed.length - CHANGED_CAP} more`]
    : changed;
}
