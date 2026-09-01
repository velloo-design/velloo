import { MAX_BOARD_NAME_LENGTH } from "@velloo/schema";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Frame as FrameIcon,
  LayoutDashboard,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Share2,
  ShieldCheck,
  Trash2,
  Unlock,
} from "lucide-react";
import { type DragEvent, useMemo, useRef, useState } from "react";
import { type BoardMeta, mutate, type ScreenMeta } from "../api.ts";
import { useCanvas } from "../store.ts";
import { pushToast, toastError } from "../toast.ts";
import { AddFrameDialog } from "./AddFrameDialog.tsx";
import { Tree } from "./Tree.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog.tsx";
import { Button } from "./ui/button.tsx";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";
import { Input } from "./ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";

interface Props {
  boards: BoardMeta[];
  screens: ScreenMeta[];
  currentBoardId: string | null;
  currentScreenId: string | null;
}

/**
 * The boards-mode left sidebar: list of boards plus the tree of the
 * active screen. The outer `<aside>` lives on the `Sidebar` shell so
 * it can swap this for `LibrarySidebar` without duplicating chrome.
 * Snippets live in the Library tab now.
 */
export function BoardsSidebar({ boards, screens, currentBoardId, currentScreenId }: Props) {
  const selectBoard = useCanvas((s) => s.selectBoard);
  const selectScreen = useCanvas((s) => s.selectScreen);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const wsConnected = useCanvas((s) => s.wsConnected);
  const boardsCollapsed = useCanvas((s) => s.boardsCollapsed);
  const treeCollapsed = useCanvas((s) => s.treeCollapsed);
  const toggleBoardsCollapsed = useCanvas((s) => s.toggleBoardsCollapsed);
  const toggleTreeCollapsed = useCanvas((s) => s.toggleTreeCollapsed);
  const reorderBoardsLocal = useCanvas((s) => s.reorderBoardsLocal);
  const boardPulse = useCanvas((s) => s.boardPulse);
  const currentScreen = useCanvas((s) =>
    currentScreenId ? (s.screens[currentScreenId] ?? null) : null,
  );
  const currentBoard = useCanvas((s) =>
    currentBoardId ? (s.boards[currentBoardId] ?? null) : null,
  );

  // Only screens placed on the active board belong in the Tree
  // dropdown — otherwise the picker offers screens unrelated to what's
  // on the canvas. Preserves frame order so the first option matches
  // the canvas' first frame.
  const boardScreens = useMemo<ScreenMeta[]>(() => {
    if (!currentBoard) return [];
    const byId = new Map(screens.map((s) => [s.id, s]));
    const seen = new Set<string>();
    const out: ScreenMeta[] = [];
    for (const f of currentBoard.frames) {
      if (seen.has(f.screen)) continue;
      seen.add(f.screen);
      const meta = byId.get(f.screen);
      if (meta) out.push(meta);
    }
    // A selection can land on a screen this board doesn't place (activity-feed
    // or search navigation) — keep it pickable so the Select never renders a
    // blank value for a real, open screen.
    if (currentScreenId && !seen.has(currentScreenId)) {
      const meta = byId.get(currentScreenId);
      if (meta) out.push(meta);
    }
    return out;
  }, [currentBoard, screens, currentScreenId]);

  const [pendingBoardDelete, setPendingBoardDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [addFrameBoardId, setAddFrameBoardId] = useState<string | null>(null);

  // One dialog serves create and rename — same shape (a name input), only
  // the title and the mutation differ.
  const [nameDialog, setNameDialog] = useState<
    { mode: "create" } | { mode: "rename"; boardId: string } | null
  >(null);
  const [boardName, setBoardName] = useState("");

  const openCreateDialog = () => {
    setBoardName("New board");
    setNameDialog({ mode: "create" });
  };

  const openRenameDialog = (b: BoardMeta) => {
    setBoardName(b.name);
    setNameDialog({ mode: "rename", boardId: b.id });
  };

  const submitNameDialog = async () => {
    const name = boardName.trim();
    if (!name || !nameDialog) return;
    const dialog = nameDialog;
    setNameDialog(null);
    if (dialog.mode === "create") {
      try {
        const r = await mutate.addBoard({ name });
        void selectBoard(r.boardId);
      } catch (err) {
        toastError(err, "Could not create board");
      }
    } else {
      try {
        await mutate.updateBoard({ boardId: dialog.boardId, patch: { name } });
      } catch (err) {
        toastError(err, "Could not rename board");
      }
    }
  };

  const confirmDeleteBoard = () => {
    if (!pendingBoardDelete) return;
    const { id } = pendingBoardDelete;
    setPendingBoardDelete(null);
    void (async () => {
      try {
        await mutate.removeBoard({ boardId: id });
        // The `board-changed` broadcast also reconciles, but pruning here
        // keeps the initiator's sidebar honest even if the WS is down.
        await useCanvas.getState().pruneBoard(id);
      } catch (e) {
        toastError(e, "Could not delete board");
      }
    })();
  };

  // ── Board drag-and-drop reordering ─────────────────────────────────────
  // A single board can't be reordered, so the drag affordances stay off —
  // and so does everything while the daemon is unreachable.
  const canReorder = boards.length > 1 && wsConnected;
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // While a drag is in flight, `dragOrder` holds the live previewed order
  // so the list reflows under the pointer. Null when not dragging.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
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

  const onBoardDragStart = (e: DragEvent<HTMLLIElement>, id: string) => {
    dropHandled.current = false;
    setDraggingId(id);
    setDragOrder(boards.map((b) => b.id));
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
    setDraggingId(null);
    setDragOrder(null);
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

  const onBoardDragEnd = () => {
    document.body.classList.remove("velloo-dragging");
    if (dropHandled.current) return;
    // Cancelled (Esc) or dropped outside the list — discard the preview.
    setDraggingId(null);
    setDragOrder(null);
  };

  // The boards list never eats the whole pane: when both panels are
  // open it's capped at half so the tree stays visible; when the tree
  // is collapsed it grows to fill instead. Collapsing a panel drops it
  // to just its header. `min-h-0` lets the inner list scroll.
  const boardsSectionClass = boardsCollapsed
    ? "shrink-0 border-b"
    : treeCollapsed
      ? "flex-1 flex flex-col min-h-0 border-b"
      : "flex flex-col min-h-0 max-h-[50%] border-b";
  const treeSectionClass = treeCollapsed ? "shrink-0" : "flex-1 flex flex-col min-h-0";

  return (
    <>
      <section className={boardsSectionClass}>
        <div className="px-4 py-2 flex items-center justify-between gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <button
            type="button"
            onClick={toggleBoardsCollapsed}
            className="flex min-w-0 items-center gap-1.5 hover:text-foreground transition-colors"
            aria-expanded={!boardsCollapsed}
            title={boardsCollapsed ? "Expand boards" : "Collapse boards"}
          >
            {boardsCollapsed ? (
              <ChevronRight size={12} strokeWidth={2.5} className="shrink-0" />
            ) : (
              <ChevronDown size={12} strokeWidth={2.5} className="shrink-0" />
            )}
            <LayoutDashboard size={11} strokeWidth={2} className="shrink-0" /> Boards
            {boardsCollapsed && boards.length > 0 ? (
              <span className="normal-case opacity-60">({boards.length})</span>
            ) : null}
          </button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={openCreateDialog}
            disabled={!wsConnected}
            title={wsConnected ? "New board" : "Disconnected — edits are paused."}
          >
            <Plus />
          </Button>
        </div>
        {boardsCollapsed ? null : boards.length === 0 ? (
          <div className="px-4 pb-2 text-sm text-muted-foreground">No boards yet.</div>
        ) : (
          <ul
            className="flex flex-1 flex-col gap-0.5 overflow-auto scroll-stable px-2 pb-2 min-h-0"
            onDragOver={onListDragOver}
            onDrop={onListDrop}
          >
            {renderedBoards.map((b) => {
              const active = b.id === currentBoardId;
              const dragging = draggingId === b.id;
              return (
                <li
                  key={b.id}
                  draggable={canReorder}
                  onDragStart={(e) => onBoardDragStart(e, b.id)}
                  onDragOver={(e) => onBoardDragOver(e, b.id)}
                  onDragEnd={onBoardDragEnd}
                  className={
                    "relative group/board rounded-md " +
                    (canReorder ? "cursor-grab active:cursor-grabbing " : "") +
                    (dragging ? "opacity-50" : "")
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      // Board data comes from the daemon — switching while
                      // disconnected would silently no-op.
                      if (!wsConnected && !active) {
                        pushToast({
                          kind: "error",
                          message:
                            "Disconnected — board switching resumes when the daemon is back.",
                        });
                        return;
                      }
                      void selectBoard(b.id);
                    }}
                    title={
                      !wsConnected && !active
                        ? "Disconnected — board switching resumes when the daemon is back."
                        : undefined
                    }
                    className={
                      "w-full text-left px-2 py-1.5 pr-8 rounded-md text-sm transition-colors " +
                      (active
                        ? "bg-primary text-primary-foreground"
                        : !wsConnected
                          ? "text-muted-foreground cursor-not-allowed opacity-60"
                          : "hover:bg-muted text-foreground")
                    }
                  >
                    <div className="font-medium truncate">
                      {b.name}
                      {!active && boardPulse[b.id] ? (
                        <span
                          data-board-pulse={b.id}
                          title="An agent edited this board recently"
                          className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle"
                        />
                      ) : null}
                    </div>
                    <div
                      className={
                        "text-xs " +
                        (active ? "text-primary-foreground/80" : "text-muted-foreground")
                      }
                    >
                      {b.frameCount} frame{b.frameCount === 1 ? "" : "s"}
                    </div>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Board menu"
                        className="absolute right-2 top-2 opacity-0 group-hover/board:opacity-100 data-[state=open]:opacity-100"
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={!wsConnected}
                        onSelect={() => openRenameDialog(b)}
                      >
                        <Pencil />
                        Rename board
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!wsConnected}
                        onSelect={() => setAddFrameBoardId(b.id)}
                      >
                        <FrameIcon />
                        Add frame…
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <Share2 />
                          Publish board
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem
                            onSelect={() =>
                              useCanvas
                                .getState()
                                .publishBoardNow({ id: b.id, name: b.name }, "public")
                            }
                          >
                            <Unlock />
                            Public
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              useCanvas
                                .getState()
                                .publishBoardNow({ id: b.id, name: b.name }, "private")
                            }
                          >
                            <Lock />
                            Private
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              useCanvas
                                .getState()
                                .publishBoardNow({ id: b.id, name: b.name }, "password")
                            }
                          >
                            <ShieldCheck />
                            Password protected…
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuItem
                        onSelect={() =>
                          useCanvas
                            .getState()
                            .setExportTarget({ kind: "board", id: b.id, name: b.name })
                        }
                      >
                        <Download />
                        Export board…
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={boards.length <= 1 || !wsConnected}
                        onSelect={() => setPendingBoardDelete({ id: b.id, name: b.name })}
                      >
                        <Trash2 />
                        Delete board
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={treeSectionClass}>
        <div className="px-4 py-2 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground border-b">
          <button
            type="button"
            onClick={toggleTreeCollapsed}
            className="shrink-0 hover:text-foreground transition-colors"
            aria-expanded={!treeCollapsed}
            title={treeCollapsed ? "Expand tree" : "Collapse tree"}
          >
            {treeCollapsed ? (
              <ChevronRight size={12} strokeWidth={2.5} />
            ) : (
              <ChevronDown size={12} strokeWidth={2.5} />
            )}
          </button>
          {boardScreens.length > 1 ? (
            <Select
              value={currentScreenId ?? ""}
              onValueChange={(id) => {
                if (id) void selectScreen(id);
              }}
            >
              <SelectTrigger
                size="sm"
                className="h-6 w-auto min-w-0 max-w-full overflow-hidden px-2 text-[10px] uppercase tracking-wider"
              >
                <SelectValue className="min-w-0 truncate" />
              </SelectTrigger>
              <SelectContent>
                {boardScreens.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="min-w-0 flex-1 truncate">{currentScreen?.name ?? "No screen"}</span>
          )}
        </div>
        {treeCollapsed ? null : (
          <div
            className={
              "flex-1 overflow-auto scroll-stable py-1 " +
              (cursorMode === "hand" ? "opacity-40 pointer-events-none select-none" : "")
            }
            aria-disabled={cursorMode === "hand"}
          >
            {currentScreen ? (
              <Tree key={currentScreen.id} screen={currentScreen} />
            ) : (
              <div className="px-4 py-2 text-xs text-muted-foreground">
                Pick a screen above to see its tree.
              </div>
            )}
          </div>
        )}
      </section>

      <Dialog
        open={nameDialog !== null}
        onOpenChange={(open) => {
          if (!open) setNameDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {nameDialog?.mode === "rename" ? "Rename board" : "New board"}
            </DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitNameDialog();
            }}
          >
            <Input
              autoFocus
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              maxLength={MAX_BOARD_NAME_LENGTH}
              placeholder="Board name"
              aria-label="Board name"
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNameDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={boardName.trim().length === 0}>
                {nameDialog?.mode === "rename" ? "Rename" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AddFrameDialog boardId={addFrameBoardId} onClose={() => setAddFrameBoardId(null)} />

      <AlertDialog
        open={pendingBoardDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingBoardDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete board</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingBoardDelete
                ? `Delete board "${pendingBoardDelete.name}"? The screens it references stay; only the placements (frames) on this board are removed. You can put it back with ⌘Z.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteBoard}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
