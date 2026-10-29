import { fetchUserPrefs, saveUserPrefs } from "./api.ts";

/**
 * First-run hints: a pinging dot on each part of the canvas worth learning,
 * opened by a click and dismissed for good. Only a couple show at once, so a
 * new canvas isn't covered in them; dismissing one brings in the next. What
 * they say and where they sit is here; `components/Hints.tsx` draws them.
 */

/** Where the dot sits on its target: a small control's corner, or inset into a large area. */
type HintAnchor = "corner" | "inset";

export interface Hint {
  id: string;
  title: string;
  body: string;
  /** What the hint is about, best first; a hint none of whose targets is on screen waits. */
  targets: readonly string[];
  anchor: HintAnchor;
  /** Which side of the dot the card opens on. */
  side: "top" | "right" | "bottom" | "left";
}

/** In the order they're shown. */
export const HINTS: readonly Hint[] = [
  {
    id: "agent",
    title: "Your agent, in the canvas",
    body: "Run Claude Code, Codex or another agent here. Select something on the board and add it to your message, so “make this bigger” knows what you mean.",
    targets: ['[data-hint="agent"]'],
    anchor: "corner",
    side: "bottom",
  },
  {
    id: "board",
    title: "Your board",
    body: "Each frame on the board is a screen of your design. Scroll to move around, and hold ⌘ or Ctrl while you scroll to zoom.",
    targets: ['[data-hint="board"]'],
    anchor: "inset",
    side: "right",
  },
  {
    id: "design",
    title: "Change what you select",
    body: "Select anything on the board to edit it under Design. Theme sets the colours and type for the whole design.",
    targets: ['[data-hint="design"]'],
    anchor: "corner",
    side: "bottom",
  },
  {
    id: "comments",
    title: "Comments",
    body: "Press C and click a design to leave a comment. Your agent can read them and make the changes.",
    targets: ['[data-hint="comment-tool"]'],
    anchor: "corner",
    side: "bottom",
  },
  {
    id: "library",
    title: "Boards and library",
    body: "Switch boards here, and see the layers of the screen you're on. Library has the components your designs are built from.",
    targets: ['[data-hint="library"]'],
    anchor: "corner",
    side: "bottom",
  },
];

/** How many hints are out at once. */
const HINTS_SHOWN = 2;

/** Less than this much of a target in the window, and its hint waits. */
const MIN_VISIBLE_PX = 12;
/** How far into a large target its dot sits. */
const INSET_PX = 28;
/** How far in from a small control's top-right corner. */
const CORNER_PX = 4;

/** The first of a hint's targets that is on screen, if any. */
function findHintTarget(hint: Hint, doc: Document = document): HTMLElement | null {
  const view = doc.defaultView;
  const width = view?.innerWidth ?? 0;
  const height = view?.innerHeight ?? 0;
  for (const selector of hint.targets) {
    const el = doc.querySelector<HTMLElement>(selector);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const visibleW = Math.min(r.right, width) - Math.max(r.left, 0);
    const visibleH = Math.min(r.bottom, height) - Math.max(r.top, 0);
    if (visibleW >= MIN_VISIBLE_PX && visibleH >= MIN_VISIBLE_PX) return el;
  }
  return null;
}

export interface PlacedHint {
  hint: Hint;
  x: number;
  y: number;
}

/** The hints to show now: the first few not yet dismissed whose target is on screen. */
export function placeHints(seen: readonly string[], doc: Document = document): PlacedHint[] {
  const placed: PlacedHint[] = [];
  for (const hint of HINTS) {
    if (placed.length === HINTS_SHOWN) break;
    if (seen.includes(hint.id)) continue;
    const el = findHintTarget(hint, doc);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    placed.push(
      hint.anchor === "inset"
        ? { hint, x: Math.round(r.left + INSET_PX), y: Math.round(r.top + INSET_PX) }
        : { hint, x: Math.round(r.right - CORNER_PX), y: Math.round(r.top + CORNER_PX) },
    );
  }
  return placed;
}

/**
 * Whether hints show on this page load.
 *
 * `?hints=0` keeps them away: the Playwright suites, capture scripts and eval
 * harnesses open a fresh canvas against a prefs file that has dismissed none,
 * and must not find dots on the board. A browser under automation
 * (`navigator.webdriver`) is treated the same, so a script that doesn't know
 * the flag still gets a clean canvas. `?hints=1` shows every hint regardless —
 * for checking them from such a browser.
 */
export function hintsMode(search: string, webdriver: boolean): "never" | "all" | "unseen" {
  const flag = new URLSearchParams(search).get("hints");
  if (flag === "0" || flag === "off") return "never";
  if (flag === "1" || flag === "on") return "all";
  return webdriver ? "never" : "unseen";
}

/**
 * Kept beside the daemon's record so a canvas whose daemon can't answer (an
 * older one, a failed write) still remembers on this origin at least.
 */
const LOCAL_KEY = "velloo:hintsSeen";

function seenLocally(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function rememberLocally(ids: string[]): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(ids));
  } catch {
    // Blocked storage: the daemon's record is the one that matters.
  }
}

/** Dismissed on this machine — by the daemon's prefs file, and this browser. */
export async function readHintsSeen(): Promise<string[]> {
  const local = seenLocally();
  try {
    return [...new Set([...(await fetchUserPrefs()).hintsSeen, ...local])];
  } catch {
    return local;
  }
}

export async function dismissHints(ids: string[]): Promise<void> {
  rememberLocally([...new Set([...seenLocally(), ...ids])]);
  try {
    await saveUserPrefs({ dismissHints: ids });
  } catch {
    // Daemon unreachable: this origin remembers, which is the best on offer.
  }
}

export async function resetHints(): Promise<void> {
  rememberLocally([]);
  try {
    await saveUserPrefs({ resetHints: true });
  } catch {
    // As above.
  }
}
