/**
 * Goal-mode scaffold helpers for init — lean boards for brand check,
 * component redesign, custom request, and a single named screen.
 */
import type { Board, Frame, Screen, Theme } from "@velloo/schema";
import type { Scaffold } from "./scaffold.ts";

const DESKTOP = { w: 1280, h: 800 };
const MOBILE = { w: 390, h: 844, gap: 40 };

/** Stable id from a user-typed screen or component name. */
function slugifyName(name: string, fallback = "screen"): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function placeholderTree(label: string): Screen["tree"] {
  return {
    $ref: "Box",
    props: {
      className: "flex min-h-screen flex-col items-center justify-center gap-3 p-8",
    },
    children: [
      {
        $ref: "Heading",
        props: { children: label, className: "text-2xl font-semibold" },
      },
      {
        $ref: "Text",
        props: {
          children: "Placeholder — ask your agent to recreate this, then explore alternatives.",
          className: "text-muted-foreground text-sm",
        },
      },
    ],
  };
}

function desktopMobileFrames(screenId: string, label: string): Frame[] {
  return [
    {
      id: `f-${screenId}`,
      screen: screenId,
      x: 80,
      y: 80,
      w: DESKTOP.w,
      h: DESKTOP.h,
      label,
    },
    {
      id: `f-${screenId}-m`,
      screen: screenId,
      x: 80 + DESKTOP.w + MOBILE.gap,
      y: 80,
      w: MOBILE.w,
      h: MOBILE.h,
      label: `${label} · Mobile`,
    },
  ];
}

/** One named screen + desktop/mobile frames on a Main board. */
export function redesignScreenScaffold(theme: Theme, screenName: string): Scaffold {
  const id = slugifyName(screenName);
  const screen: Screen = {
    id,
    name: screenName.trim() || id,
    tree: placeholderTree(screenName.trim() || id),
  };
  const board: Board = {
    id: "main",
    name: "Main",
    frames: desktopMobileFrames(id, screen.name),
    groups: [],
  };
  return {
    theme,
    screens: [screen],
    boards: [board],
    snippets: [],
    annotations: [],
    notes: [],
  };
}

/** Component/snippet-focused board with a named placeholder screen. */
export function componentScaffold(theme: Theme, componentDescription: string): Scaffold {
  const label = componentDescription.trim() || "Component";
  const id = slugifyName(label, "component");
  const screen: Screen = {
    id,
    name: label,
    tree: placeholderTree(label),
  };
  const board: Board = {
    id: "component",
    name: "Component",
    frames: desktopMobileFrames(id, label).map((f) => ({ ...f, group: "explorations" })),
    groups: [{ id: "explorations", name: "Explorations" }],
  };
  return {
    theme,
    screens: [screen],
    boards: [board],
    snippets: [],
    annotations: [],
    notes: [],
  };
}

/** Custom request: one empty Main board so the canvas isn't zero-board. */
export function customRequestScaffold(theme: Theme): Scaffold {
  return {
    theme,
    screens: [],
    boards: [{ id: "main", name: "Main", frames: [], groups: [] }],
    snippets: [],
    annotations: [],
    notes: [],
  };
}
