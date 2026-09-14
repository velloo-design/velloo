import { type DragEvent, useMemo, useRef, useState } from "react";
import { type BoardGroupMeta, type BoardMeta, mutate } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import type { BoardRowDrag } from "./BoardRow.tsx";

interface BoardSection {
  group: BoardGroupMeta | null;
  boards: BoardMeta[];
}

/**
 * Drag-and-drop over the board list: reorder, and refile across group rails.
 * The list reflows under the pointer while a drag is in flight, so the
 * sections it returns already show the previewed order and group.
 */
export function useBoardDrag({
  boards,
  groups,
  enabled,
  onRefile,
}: {
  boards: BoardMeta[];
  groups: BoardGroupMeta[];
  /** False while the daemon is unreachable — reorders couldn't be saved. */
  enabled: boolean;
  onRefile(boardId: string, group: string | null): void;
}) {
  const reorderBoardsLocal = useCanvas((s) => s.reorderBoardsLocal);
  // A single board can't be reordered, so the drag affordances stay off.
  const canReorder = boards.length > 1 && enabled;
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // While a drag is in flight, `dragOrder` holds the live previewed order
  // so the list reflows under the pointer. Null when not dragging.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  // Group the dragged board would land in, previewed live. `undefined` = the
  // drag hasn't crossed a group boundary, so the drop only reorders.
  const [dragGroup, setDragGroup] = useState<string | null | undefined>(undefined);
  // Distinguishes a real drop (persist) from a cancelled drag / drop
  // outside the list (revert). `onDragEnd` fires for both.
  const dropHandled = useRef(false);

  const renderedBoards = useMemo<BoardMeta[]>(() => {
    if (!dragOrder) return boards;
    const byId = new Map(boards.map((b) => [b.id, b]));
    const out: BoardMeta[] = [];
    for (const id of dragOrder) {
      const b = byId.get(id);
      if (b) out.push(b);
    }
    for (const b of boards) if (!dragOrder.includes(b.id)) out.push(b);
    return out;
  }, [dragOrder, boards]);

  const endDrag = () => {
    setDraggingId(null);
    setDragOrder(null);
    setDragGroup(undefined);
  };

  const onBoardDragStart = (e: DragEvent<HTMLLIElement>, id: string) => {
    dropHandled.current = false;
    setDraggingId(id);
    setDragOrder(boards.map((b) => b.id));
    setDragGroup(undefined);
    e.dataTransfer.effectAllowed = "move";
    // Firefox won't start a drag unless some data is attached.
    e.dataTransfer.setData("text/plain", id);
    // Grabbing cursor workspace-wide for the duration of the drag (and
    // the styles.css rule also drops design-iframe pointer-events so a
    // frame can't swallow the drop).
    document.body.classList.add("velloo-dragging");
  };

  // Reflow the previewed order as the pointer passes over a sibling: pull
  // the dragged id out and reinsert it at the hovered row's index.
  const onBoardDragOver = (e: DragEvent<HTMLLIElement>, overId: string) => {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overId === draggingId) return;
    // Hovering a row in another group means "put it there" — the drop both
    // reorders and refiles, which is what dragging across a rail looks like.
    const over = boards.find((b) => b.id === overId);
    if (over) setDragGroup(over.group ?? null);
    setDragOrder((prev) => {
      const cur = prev ?? boards.map((b) => b.id);
      const from = cur.indexOf(draggingId);
      const to = cur.indexOf(overId);
      if (from === -1 || to === -1 || from === to) return cur;
      const next = [...cur];
      next.splice(from, 1);
      next.splice(to, 0, draggingId);
      return next;
    });
  };

  const onBoardDragEnd = () => {
    document.body.classList.remove("velloo-dragging");
    if (dropHandled.current) return;
    // Cancelled (Esc) or dropped outside the list — discard the preview.
    endDrag();
  };

  /** Hovering a group header (or the Ungrouped header) files into that group. */
  const onGroupDragOver = (e: DragEvent<HTMLLIElement>, groupId: string | null) => {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragGroup(groupId);
  };

  // Drops bubble to the list so a release in a gap or the empty space
  // below the last row still lands — the previewed `dragOrder` already
  // reflects the final position.
  const onListDragOver = (e: DragEvent<HTMLUListElement>) => {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const onListDrop = (e: DragEvent<HTMLUListElement>) => {
    if (!draggingId) return;
    e.preventDefault();
    dropHandled.current = true;
    const order = dragOrder;
    const nextGroup = dragGroup;
    const dragged = boards.find((b) => b.id === draggingId);
    endDrag();
    if (dragged && nextGroup !== undefined && (dragged.group ?? null) !== nextGroup) {
      onRefile(dragged.id, nextGroup);
    }
    if (!order) return;
    const original = boards.map((b) => b.id);
    if (order.length === original.length && order.every((id, i) => id === original[i])) return;
    // Optimistic: reorder the store now so the list doesn't flash back to
    // the old order before the server's `config-changed` reconciles.
    reorderBoardsLocal(order);
    void mutate.reorderBoards({ order }).catch((err) => {
      toastError(err, "Could not reorder boards");
      void useCanvas.getState().refreshDesignSummary();
    });
  };

  const rowDrag = (id: string): BoardRowDrag => ({
    draggable: canReorder,
    dragging: draggingId === id,
    onDragStart: (e) => onBoardDragStart(e, id),
    onDragOver: (e) => onBoardDragOver(e, id),
    onDragEnd: onBoardDragEnd,
  });

  /**
   * The sidebar's shape: one section per group in `boardGroups` order, then
   * the ungrouped remainder. Board order within a section stays the folder's
   * global order (`renderedBoards`), so drag-reorder keeps working unchanged.
   * A folder with no groups yields a single ungrouped section — today's flat
   * list, headerless.
   */
  const sections = useMemo<BoardSection[]>(() => {
    const groupOf = (b: BoardMeta) =>
      // While dragging across a rail the preview shows the board already in
      // the target group, so the row moves under the pointer rather than
      // snapping there only on release.
      b.id === draggingId && dragGroup !== undefined ? dragGroup : (b.group ?? null);
    const live = new Set(groups.map((g) => g.id));
    const out: BoardSection[] = groups.map((group) => ({
      group,
      boards: renderedBoards.filter((b) => groupOf(b) === group.id),
    }));
    // A board pointing at a group that no longer exists reads as ungrouped
    // rather than disappearing.
    const loose = renderedBoards.filter((b) => {
      const g = groupOf(b);
      return g === null || !live.has(g);
    });
    out.push({ group: null, boards: loose });
    return out;
  }, [groups, renderedBoards, draggingId, dragGroup]);

  return {
    sections,
    dragging: draggingId !== null,
    dragGroup,
    rowDrag,
    onGroupDragOver,
    onListDragOver,
    onListDrop,
  };
}
