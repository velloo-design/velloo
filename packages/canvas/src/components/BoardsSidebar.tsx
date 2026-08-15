import { LayoutDashboard, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { type BoardMeta, mutate, type ScreenMeta } from "../api.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Tree } from "./Tree.tsx";

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

  const [boardMenuOpenFor, setBoardMenuOpenFor] = useState<string | null>(null);
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

  return (
    <>
      <section className="border-b border-[var(--color-border)] py-2">
        <div className="px-4 py-2 flex items-center justify-between gap-2 text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
          <span className="flex items-center gap-1.5">
            <LayoutDashboard size={11} strokeWidth={2} /> Boards
          </span>
          <button
            type="button"
            onClick={onCreateBoard}
            title="New board"
            className="h-5 w-5 grid place-items-center rounded hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)]"
          >
            <Plus size={13} strokeWidth={2} />
          </button>
        </div>
        {boards.length === 0 ? (
          <div className="px-4 py-2 text-sm text-[var(--color-fg-muted)]">No boards yet.</div>
        ) : (
          <ul className="flex flex-col px-2 gap-0.5 mt-1">
            {boards.map((b) => {
              const active = b.id === currentBoardId;
              const menuOpen = boardMenuOpenFor === b.id;
              return (
                <li key={b.id} className="relative group/board">
                  <button
                    type="button"
                    onClick={() => {
                      void selectBoard(b.id);
                    }}
                    className={
                      "w-full text-left px-2 py-1.5 pr-8 rounded text-sm transition-colors " +
                      (active
                        ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                        : "hover:bg-[var(--color-bg)] text-[var(--color-fg)]")
                    }
                  >
                    <div className="font-medium truncate">{b.name}</div>
                    <div
                      className={
                        "text-xs " +
                        (active
                          ? "text-[var(--color-accent-fg)] opacity-80"
                          : "text-[var(--color-fg-muted)]")
                      }
                    >
                      {b.frameCount} frame{b.frameCount === 1 ? "" : "s"}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      setBoardMenuOpenFor(menuOpen ? null : b.id);
                    }}
                    title="Board menu"
                    className={
                      "absolute right-2 top-2 h-5 w-5 grid place-items-center rounded text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] " +
                      (menuOpen ? "opacity-100" : "opacity-0 group-hover/board:opacity-100")
                    }
                  >
                    <MoreHorizontal size={13} strokeWidth={2} />
                  </button>
                  {menuOpen ? (
                    <>
                      <button
                        type="button"
                        aria-label="Close menu"
                        onClick={() => setBoardMenuOpenFor(null)}
                        className="fixed inset-0 z-40 cursor-default"
                      />
                      <div className="absolute right-2 top-9 z-50 w-36 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-md py-1 text-sm">
                        <button
                          type="button"
                          disabled={boards.length <= 1}
                          onClick={() => {
                            setBoardMenuOpenFor(null);
                            setPendingBoardDelete({ id: b.id, name: b.name });
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--color-destructive,red)] hover:bg-[var(--color-bg)] disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <Trash2 size={13} strokeWidth={2} />
                          Delete board
                        </button>
                      </div>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex-1 flex flex-col min-h-0">
        <div className="px-4 py-2 flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--color-fg-muted)] border-b border-[var(--color-border)]">
          <span className="flex-1 truncate">
            Tree {currentScreen ? `· ${currentScreen.name}` : ""}
          </span>
          {boardScreens.length > 1 ? (
            <select
              value={currentScreenId ?? ""}
              onChange={(e) => {
                const id = e.target.value;
                if (id) void selectScreen(id);
              }}
              className="text-[10px] uppercase tracking-wider rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 max-w-[110px]"
            >
              {boardScreens.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
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
            <div className="px-4 py-2 text-xs text-[var(--color-fg-muted)]">
              Pick a screen above to see its tree.
            </div>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={pendingBoardDelete !== null}
        title="Delete board"
        body={
          pendingBoardDelete
            ? `Delete board "${pendingBoardDelete.name}"? The screens it references stay; only the placements (frames) on this board are removed. You can put it back with ⌘Z.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        onCancel={() => setPendingBoardDelete(null)}
        onConfirm={confirmDeleteBoard}
      />
    </>
  );
}
