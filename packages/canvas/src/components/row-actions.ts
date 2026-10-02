/**
 * The small icon buttons that appear on a hovered row — tree nodes, comment
 * threads. One look for both, so the two lists read as the same kind of thing.
 *
 * The hover colours live in the variant, never the base: two `hover:text-*`
 * utilities on one element resolve by stylesheet order, not class order, so a
 * shared neutral hover silently beats a destructive one.
 */
const ROW_ACTION_BASE =
  "inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors";

export const ROW_ACTION_CLASS = `${ROW_ACTION_BASE} hover:bg-muted hover:text-foreground`;

export const ROW_ACTION_DESTRUCTIVE_CLASS = `${ROW_ACTION_BASE} hover:bg-destructive/10 hover:text-destructive`;

/** Gap between a row's action buttons. */
export const ROW_ACTIONS_GAP = "gap-px";

export const ROW_ACTION_ICON = { size: 11, strokeWidth: 2 } as const;
