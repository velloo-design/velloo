import {
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { type BoardMeta, mutate, type ScreenMeta } from "../api.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";
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
  const boardsCollapsed = useCanvas((s) => s.boardsCollapsed);
  const treeCollapsed = useCanvas((s) => s.treeCollapsed);
  const toggleBoardsCollapsed = useCanvas((s) => s.toggleBoardsCollapsed);
  const toggleTreeCollapsed = useCanvas((s) => s.toggleTreeCollapsed);
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
    return out;
  }, [currentBoard, screens]);

  const [pendingBoardDelete, setPendingBoardDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const onCreateBoard = async () => {
    const name = window.prompt("Board name", "New board");
    if (!name) return;
    try {
      const r = await mutate.addBoard({ name });
      void selectBoard(r.boardId);
    } catch (err) {
      toastError(err, "Could not create board");
    }
  };

  const confirmDeleteBoard = () => {
    if (!pendingBoardDelete) return;
    const { id } = pendingBoardDelete;
    setPendingBoardDelete(null);
    void mutate.removeBoard({ boardId: id }).catch((e) => toastError(e, "Could not delete board"));
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
          <Button variant="ghost" size="icon-xs" onClick={onCreateBoard} title="New board">
            <Plus />
          </Button>
        </div>
        {boardsCollapsed ? null : boards.length === 0 ? (
          <div className="px-4 pb-2 text-sm text-muted-foreground">No boards yet.</div>
        ) : (
          <ul className="flex flex-1 flex-col gap-0.5 overflow-auto px-2 pb-2 min-h-0">
            {boards.map((b) => {
              const active = b.id === currentBoardId;
              return (
                <li key={b.id} className="relative group/board">
                  <button
                    type="button"
                    onClick={() => {
                      void selectBoard(b.id);
                    }}
                    className={
                      "w-full text-left px-2 py-1.5 pr-8 rounded-md text-sm transition-colors " +
                      (active
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted text-foreground")
                    }
                  >
                    <div className="font-medium truncate">{b.name}</div>
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
                        variant="destructive"
                        disabled={boards.length <= 1}
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
              "flex-1 overflow-auto py-1 " +
              (cursorMode === "hand" ? "opacity-40 pointer-events-none select-none" : "")
            }
            aria-disabled={cursorMode === "hand"}
          >
            {currentScreen ? (
              <Tree screen={currentScreen} />
            ) : (
              <div className="px-4 py-2 text-xs text-muted-foreground">
                Pick a screen above to see its tree.
              </div>
            )}
          </div>
        )}
      </section>

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
