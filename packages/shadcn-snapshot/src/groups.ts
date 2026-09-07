/**
 * Which shelf each shadcn family sits on, keyed by its source file — the same
 * key `build.ts` already resolves per component, so a newly vendored family
 * gets grouped by adding one line here rather than by being re-listed
 * somewhere downstream.
 *
 * A family with no entry falls into the catch-all bucket, which is why the
 * manifest test asserts this table covers every vendored file: the previous
 * arrangement kept the grouping in the canvas sidebar, where 20 new families
 * were silently unbrowsable because nothing failed when the list went stale.
 */
import type { ComponentGroup } from "@velloo/provider";

export const FAMILY_GROUPS: Record<string, ComponentGroup> = {
  button: "actions",
  "button-group": "actions",
  toggle: "actions",
  "toggle-group": "actions",

  input: "forms",
  textarea: "forms",
  label: "forms",
  checkbox: "forms",
  "radio-group": "forms",
  switch: "forms",
  slider: "forms",
  select: "forms",
  "native-select": "forms",
  combobox: "forms",
  calendar: "forms",
  field: "forms",
  "input-group": "forms",

  avatar: "display",
  badge: "display",
  card: "display",
  skeleton: "display",
  table: "display",
  item: "display",
  kbd: "display",

  alert: "feedback",
  progress: "feedback",
  sonner: "feedback",
  spinner: "feedback",
  empty: "feedback",

  tabs: "navigation",
  breadcrumb: "navigation",
  pagination: "navigation",
  accordion: "navigation",
  "navigation-menu": "navigation",
  menubar: "navigation",

  dialog: "overlays",
  "alert-dialog": "overlays",
  sheet: "overlays",
  drawer: "overlays",
  popover: "overlays",
  "dropdown-menu": "overlays",
  "context-menu": "overlays",
  "hover-card": "overlays",
  tooltip: "overlays",
  collapsible: "overlays",

  "scroll-area": "layout",
  separator: "layout",
  carousel: "layout",
  "aspect-ratio": "layout",

  chart: "visuals",

  attachment: "chat",
  bubble: "chat",
  message: "chat",
  marker: "chat",
};

/**
 * Families that are intentionally ungrouped: real exports an agent can name,
 * but not components anyone browses for. Listed rather than omitted so the
 * coverage test can tell "decided" from "forgotten".
 */
export const UNGROUPED_FAMILIES: ReadonlySet<string> = new Set([
  // Context provider for RTL — wraps a tree, renders no UI of its own.
  "direction",
]);
