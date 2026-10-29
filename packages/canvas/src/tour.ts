import { fetchUserPrefs, saveUserPrefs } from "./api.ts";
import type { RightTab } from "./store/types.ts";

/**
 * The first-run tour: what it says, what it points at, and whether this
 * person has seen it. The component that draws it is `components/Tour.tsx`.
 */

/** Where the card sits against what it points at; `inside` is for a target as big as the board. */
export type TourPlacement = "inside" | "right" | "left" | "bottom";

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /**
   * What the step points at, best first. A pane collapsed to its rail shows
   * different elements than an open one, so a step can name both; a step none
   * of whose targets is on screen is left out of the tour.
   */
  targets: readonly string[];
  placement: TourPlacement;
  /** The right panel's tab the step talks about, shown while it's open. */
  rightTab?: RightTab;
}

const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "board",
    title: "Your board",
    body: "Each frame on the board is a screen of your design. Scroll to move around, and hold ⌘ or Ctrl while you scroll to zoom.",
    targets: ['[data-tour="board"]'],
    placement: "inside",
  },
  {
    id: "sidebar",
    title: "Boards and library",
    body: "Switch boards here and see the layers of the screen you're on. Library has the components your designs are built from.",
    targets: ['aside[data-pane="left"]'],
    placement: "right",
  },
  {
    id: "design",
    title: "Change what you select",
    body: "Select anything on the board to edit it under Design. Theme sets the colours and type for the whole design.",
    targets: ['aside[data-pane="right"]'],
    placement: "left",
    rightTab: "node",
  },
  {
    id: "agent",
    title: "Your agent",
    body: "Run Claude Code, Codex or another agent right here. Select something on the board and add it to your message, so “make this bigger” knows what you mean.",
    targets: ['[data-tour="agent"]', 'aside[data-pane="right"] button[aria-label="Agent"]'],
    placement: "bottom",
  },
  {
    id: "comments",
    title: "Comments",
    body: "Press C and click a design to leave a comment. Your agent can read them and make the changes. You can take this tour again from the menu at the top right.",
    targets: ['[data-tour="comment-tool"]'],
    placement: "bottom",
  },
];

/** Less than this much of a target in the window, and the step is skipped. */
const MIN_VISIBLE_PX = 24;

/** The first of a step's targets that is actually on screen, if any. */
export function findTourTarget(step: TourStep, doc: Document = document): HTMLElement | null {
  const view = doc.defaultView;
  const width = view?.innerWidth ?? 0;
  const height = view?.innerHeight ?? 0;
  for (const selector of step.targets) {
    const el = doc.querySelector<HTMLElement>(selector);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const visibleW = Math.min(r.right, width) - Math.max(r.left, 0);
    const visibleH = Math.min(r.bottom, height) - Math.max(r.top, 0);
    if (visibleW >= MIN_VISIBLE_PX && visibleH >= MIN_VISIBLE_PX) return el;
  }
  return null;
}

/** The steps that have something on screen to point at, in order. */
export function availableTourSteps(doc: Document = document): TourStep[] {
  return TOUR_STEPS.filter((step) => findTourTarget(step, doc) !== null);
}

/**
 * Whether the tour may open by itself on this page load. A replay from the
 * menu ignores this.
 *
 * `?tour=0` keeps it away: the Playwright suites, capture scripts and eval
 * harnesses open a fresh canvas against a prefs file that has never seen the
 * tour, and must not find it covering the board. A browser under automation
 * (`navigator.webdriver`) is treated the same, so a script that doesn't know
 * the flag still gets a clean canvas. `?tour=1` shows it regardless — for
 * checking the tour itself from such a browser.
 */
export function tourAutoStart(
  search: string,
  webdriver: boolean,
): "never" | "always" | "first-run" {
  const flag = new URLSearchParams(search).get("tour");
  if (flag === "0" || flag === "off") return "never";
  if (flag === "1" || flag === "on") return "always";
  return webdriver ? "never" : "first-run";
}

/**
 * Kept beside the daemon's record so a canvas whose daemon can't answer (an
 * older one, a failed write) still remembers on this origin at least.
 */
const LOCAL_KEY = "velloo:tourSeen";

function seenLocally(): boolean {
  try {
    return localStorage.getItem(LOCAL_KEY) === "true";
  } catch {
    return false;
  }
}

/** Seen on this machine — by the daemon's prefs file, or failing that, this browser. */
export async function readTourSeen(): Promise<boolean> {
  if (seenLocally()) return true;
  try {
    return (await fetchUserPrefs()).tourSeen;
  } catch {
    return false;
  }
}

export async function markTourSeen(): Promise<void> {
  try {
    localStorage.setItem(LOCAL_KEY, "true");
  } catch {
    // Blocked storage: the daemon's record is the one that matters.
  }
  try {
    await saveUserPrefs({ tourSeen: true });
  } catch {
    // Daemon unreachable: this origin remembers, which is the best on offer.
  }
}
