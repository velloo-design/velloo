import { MAX_BOARD_NAME_LENGTH } from "@velloo/schema";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FolderInput,
  FolderPlus,
  Frame as FrameIcon,
  LayoutDashboard,
  Lock,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Share2,
  ShieldCheck,
  Trash2,
  Unlock,
} from "lucide-react";
import { type DragEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { type BoardGroupMeta, type BoardMeta, mutate, type ScreenMeta } from "../api.ts";
import { ICON_MENU_WIDTH } from "../lib/utils.ts";
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
import { Empty, EmptyDescription } from "./ui/empty.tsx";
import { Input } from "./ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";

/** Stable empty array so the `archivedBoards` selector doesn't re-render on every store tick. */
const EMPTY_BOARDS: BoardMeta[] = [];
/** Same, for the groups selector. */
const EMPTY_GROUPS: BoardGroupMeta[] = [];

/** Colors offered in a group's recolor menu — the server's palette, named. */
const GROUP_COLORS = [
  { value: "#8b5cf6", label: "Violet" },
  { value: "#0ea5e9", label: "Sky" },
  { value: "#f59e0b", label: "Amber" },
  { value: "#f43f5e", label: "Rose" },
  { value: "#10b981", label: "Emerald" },
  { value: "#6366f1", label: "Indigo" },
  { value: "#ec4899", label: "Pink" },
  { value: "#84cc16", label: "Lime" },
];

const COLLAPSED_GROUPS_KEY = "velloo:collapsedBoardGroups";

/** Collapsed groups are a per-browser convenience, not folder state. */
function readCollapsedGroups(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** "Aug 25" — enough to date an archived board without widening the row. */
function archivedOn(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "archived";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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
  const setBoardArchived = useCanvas((s) => s.setBoardArchived);
  const archivedBoards = useCanvas((s) => s.design?.archivedBoards ?? EMPTY_BOARDS);
  const groups = useCanvas((s) => s.design?.boardGroups ?? EMPTY_GROUPS);
  const currentScreen = useCanvas((s) =>
    currentScreenId ? (s.screens[currentScreenId] ?? null) : null,
  );
  const snippetFocus = useCanvas((s) => s.snippetFocus);
  const setSnippetFocus = useCanvas((s) => s.setSnippetFocus);
  const focusedScreen = useCanvas((s) =>
    s.snippetFocus ? (s.screens[`snippet:${s.snippetFocus}`] ?? null) : null,
  );
  // Editing a snippet in place scopes everything to its definition, and the
  // tree is the one place you can reach a node the canvas doesn't show.
  const treeScreen = focusedScreen ?? currentScreen;
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

  // Group create/rename share one dialog, same as boards. `boardId` carries
  // the board waiting to be filed when the group is created from its menu.
  const [groupDialog, setGroupDialog] = useState<
    { mode: "create"; boardId?: string } | { mode: "rename"; groupId: string } | null
  >(null);
  const [groupName, setGroupName] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(readCollapsedGroups);
  const [pendingGroupDelete, setPendingGroupDelete] = useState<BoardGroupMeta | null>(null);

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId];
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(next));
      }
      return next;
    });
  };

  const openGroupDialog = (
    dialog: { mode: "create"; boardId?: string } | { mode: "rename"; group: BoardGroupMeta },
  ) => {
    if (dialog.mode === "create") {
      setGroupName("New group");
      setGroupDialog({ mode: "create", ...(dialog.boardId ? { boardId: dialog.boardId } : {}) });
    } else {
      setGroupName(dialog.group.name);
      setGroupDialog({ mode: "rename", groupId: dialog.group.id });
    }
  };

  const submitGroupDialog = async () => {
    const name = groupName.trim();
    if (!name || !groupDialog) return;
    const dialog = groupDialog;
    setGroupDialog(null);
    try {
      if (dialog.mode === "rename") {
        await mutate.updateBoardGroup({ groupId: dialog.groupId, patch: { name } });
      } else if (dialog.boardId) {
        // Creating from a board's "New group…" both creates and files it —
        // `group` takes a name and creates on miss, so one call does both.
        await mutate.updateBoard({ boardId: dialog.boardId, patch: { group: name } });
      } else {
        await mutate.addBoardGroup({ name });
      }
      await useCanvas.getState().refreshDesignSummary();
    } catch (err) {
      toastError(err, dialog.mode === "rename" ? "Could not rename group" : "Could not add group");
    }
  };

  const recolorGroup = (groupId: string, color: string) => {
    void mutate
      .updateBoardGroup({ groupId, patch: { color } })
      .then(() => useCanvas.getState().refreshDesignSummary())
      .catch((err: unknown) => toastError(err, "Could not recolor group"));
  };

  const confirmDeleteGroup = () => {
    if (!pendingGroupDelete) return;
    const { id, name } = pendingGroupDelete;
    setPendingGroupDelete(null);
    void (async () => {
      try {
        const r = await mutate.removeBoardGroup({ groupId: id });
        await useCanvas.getState().refreshDesignSummary();
        pushToast({
          kind: "info",
          message:
            r.ungroupedBoardIds.length > 0
              ? `Deleted "${name}" — ${r.ungroupedBoardIds.length} board${r.ungroupedBoardIds.length === 1 ? "" : "s"} moved to Ungrouped`
              : `Deleted "${name}"`,
        });
      } catch (err) {
        toastError(err, "Could not delete group");
      }
    })();
  };

  const moveBoardToGroup = (boardId: string, group: string | null) => {
    void mutate
      .updateBoard({ boardId, patch: { group } })
      .then(() => useCanvas.getState().refreshDesignSummary())
      .catch((err: unknown) => toastError(err, "Could not move board"));
  };

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
    const { id, name } = pendingBoardDelete;
    setPendingBoardDelete(null);
    void (async () => {
      try {
        const r = await mutate.removeBoard({ boardId: id });
        // The `board-changed` broadcast also reconciles, but pruning here
        // keeps the initiator's sidebar honest even if the WS is down.
        useCanvas.getState().pruneScreens(r.removedScreenIds);
        await useCanvas.getState().pruneBoard(id);
        const n = r.removedScreenIds.length;
        pushToast({
          kind: "info",
          message:
            n > 0 ? `Deleted "${name}" and ${n} screen${n === 1 ? "" : "s"}` : `Deleted "${name}"`,
        });
      } catch (e) {
        toastError(e, "Could not delete board");
      }
    })();
  };

  // Collapsed by default: the archive is a filing cabinet, not a second list.
  const [archivedOpen, setArchivedOpen] = useState(false);

  // Landing on an archived board (search, a shared ?board= link) with the
  // section shut would leave the sidebar showing no selection at all.
  const currentIsArchived = archivedBoards.some((b) => b.id === currentBoardId);
  useEffect(() => {
    if (currentIsArchived) setArchivedOpen(true);
  }, [currentIsArchived]);

  const archiveBoard = (b: BoardMeta, archived: boolean) => {
    void (async () => {
      try {
        await setBoardArchived(b.id, archived);
        pushToast({
          kind: "info",
          message: archived ? `Archived "${b.name}"` : `Restored "${b.name}"`,
        });
        if (archived) setArchivedOpen(true);
      } catch (e) {
        toastError(e, archived ? "Could not archive board" : "Could not restore board");
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
    setDraggingId(null);
    setDragOrder(null);
    setDragGroup(undefined);
    if (dragged && nextGroup !== undefined && (dragged.group ?? null) !== nextGroup) {
      moveBoardToGroup(dragged.id, nextGroup);
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

  const onBoardDragEnd = () => {
    document.body.classList.remove("velloo-dragging");
    if (dropHandled.current) return;
    // Cancelled (Esc) or dropped outside the list — discard the preview.
    setDraggingId(null);
    setDragOrder(null);
    setDragGroup(undefined);
  };

  /**
   * The sidebar's shape: one section per group in `boardGroups` order, then
   * the ungrouped remainder. Board order within a section stays the folder's
   * global order (`renderedBoards`), so drag-reorder keeps working unchanged.
   * A folder with no groups yields a single ungrouped section — today's flat
   * list, headerless.
   */
  const sections = useMemo<{ group: BoardGroupMeta | null; boards: BoardMeta[] }[]>(() => {
    const groupOf = (b: BoardMeta) =>
      // While dragging across a rail the preview shows the board already in
      // the target group, so the row moves under the pointer rather than
      // snapping there only on release.
      b.id === draggingId && dragGroup !== undefined ? dragGroup : (b.group ?? null);
    const live = new Set(groups.map((g) => g.id));
    const out = groups.map((group) => ({
      group: group as BoardGroupMeta | null,
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

  /** One board row — rendered flat, or nested under its group's rail. */
  const renderBoardRow = (b: BoardMeta) => {
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
                message: "Disconnected — board switching resumes when the daemon is back.",
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
            className={`text-xs ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}
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
          <DropdownMenuContent align="end" className={ICON_MENU_WIDTH}>
            <DropdownMenuItem disabled={!wsConnected} onSelect={() => openRenameDialog(b)}>
              <Pencil />
              Rename board
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!wsConnected} onSelect={() => setAddFrameBoardId(b.id)}>
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
                    useCanvas.getState().publishBoardNow({ id: b.id, name: b.name }, "public")
                  }
                >
                  <Unlock />
                  Public
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    useCanvas.getState().publishBoardNow({ id: b.id, name: b.name }, "private")
                  }
                >
                  <Lock />
                  Private
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    useCanvas.getState().publishBoardNow({ id: b.id, name: b.name }, "password")
                  }
                >
                  <ShieldCheck />
                  Password protected…
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!wsConnected}>
                <FolderInput />
                Move to group
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {groups.map((g) => (
                  <DropdownMenuItem key={g.id} onSelect={() => moveBoardToGroup(b.id, g.id)}>
                    <span
                      className="size-2.5 rounded-[3px]"
                      style={{ backgroundColor: g.color ?? "var(--muted-foreground)" }}
                    />
                    {g.name}
                    {b.group === g.id ? <Check className="ml-auto" /> : null}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onSelect={() => moveBoardToGroup(b.id, null)}>
                  <span className="size-2.5 rounded-[3px] border border-dashed" />
                  No group
                  {b.group ? null : <Check className="ml-auto" />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => openGroupDialog({ mode: "create", boardId: b.id })}
                >
                  <FolderPlus />
                  New group…
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              onSelect={() =>
                useCanvas.getState().setExportTarget({ kind: "board", id: b.id, name: b.name })
              }
            >
              <Download />
              Export board…
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!wsConnected} onSelect={() => archiveBoard(b, true)}>
              <Archive />
              Archive board
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={!wsConnected}
              onSelect={() => setPendingBoardDelete({ id: b.id, name: b.name })}
            >
              <Trash2 />
              Delete board
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    );
  };

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
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => openGroupDialog({ mode: "create" })}
              disabled={!wsConnected}
              title={wsConnected ? "New group" : "Disconnected — edits are paused."}
            >
              <FolderPlus />
            </Button>
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
        </div>
        {boardsCollapsed ? null : boards.length === 0 ? (
          <Empty className="gap-1 px-4 pb-2 pt-0">
            <EmptyDescription className="text-sm">
              {archivedBoards.length > 0 ? "No boards — everything's archived." : "No boards yet."}
            </EmptyDescription>
          </Empty>
        ) : (
          <ul
            className="flex flex-1 flex-col gap-0.5 overflow-auto scroll-stable px-2 pb-2 min-h-0"
            onDragOver={onListDragOver}
            onDrop={onListDrop}
          >
            {sections.map((section) => {
              const group = section.group;
              return group ? (
                <li key={group.id}>
                  <GroupHeader
                    group={group}
                    count={section.boards.length}
                    collapsed={collapsedGroups.includes(group.id)}
                    dropTarget={dragGroup === group.id}
                    disabled={!wsConnected}
                    onToggle={() => toggleGroup(group.id)}
                    onDragOver={(e) => onGroupDragOver(e, group.id)}
                    onRename={() => openGroupDialog({ mode: "rename", group })}
                    onRecolor={(color) => recolorGroup(group.id, color)}
                    onDelete={() => setPendingGroupDelete(group)}
                  />
                  {collapsedGroups.includes(group.id) ? null : (
                    <ul
                      className="ml-[15px] flex flex-col gap-0.5 border-l-2 pl-2"
                      style={{ borderColor: group.color ?? "var(--border)" }}
                    >
                      {section.boards.map(renderBoardRow)}
                    </ul>
                  )}
                </li>
              ) : (
                <Fragment key="__ungrouped">
                  {groups.length > 0 && section.boards.length > 0 ? (
                    <li
                      onDragOver={(e) => onGroupDragOver(e, null)}
                      className={
                        "mt-1 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] uppercase tracking-wide text-muted-foreground " +
                        (dragGroup === null && draggingId ? "bg-accent" : "")
                      }
                    >
                      <span className="size-2.5 shrink-0 rounded-[3px] border border-dashed" />
                      Ungrouped
                      <span className="ml-auto normal-case opacity-70">
                        {section.boards.length}
                      </span>
                    </li>
                  ) : null}
                  {section.boards.map(renderBoardRow)}
                </Fragment>
              );
            })}
          </ul>
        )}
        {boardsCollapsed || archivedBoards.length === 0 ? null : (
          <div className="shrink-0 border-t px-2 py-1.5">
            <button
              type="button"
              onClick={() => setArchivedOpen((v) => !v)}
              aria-expanded={archivedOpen}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            >
              {archivedOpen ? (
                <ChevronDown size={12} strokeWidth={2.5} className="shrink-0" />
              ) : (
                <ChevronRight size={12} strokeWidth={2.5} className="shrink-0" />
              )}
              <Archive size={11} strokeWidth={2} className="shrink-0" /> Archived
              <span className="normal-case opacity-60">({archivedBoards.length})</span>
            </button>
            {archivedOpen ? (
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {archivedBoards.map((b) => {
                  const active = b.id === currentBoardId;
                  return (
                    <li key={b.id} className="relative group/board rounded-md">
                      <button
                        type="button"
                        onClick={() => {
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
                        // An archived board is still fully editable — opening
                        // one is normal, it just isn't in the way by default.
                        className={
                          "w-full text-left px-2 py-1.5 pr-8 rounded-md text-sm transition-colors " +
                          (active
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-muted text-muted-foreground")
                        }
                      >
                        <div className="truncate">{b.name}</div>
                        <div
                          className={
                            "text-xs " +
                            (active ? "text-primary-foreground/80" : "text-muted-foreground/70")
                          }
                        >
                          {b.frameCount} frame{b.frameCount === 1 ? "" : "s"}
                          {b.archivedAt ? ` · ${archivedOn(b.archivedAt)}` : ""}
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
                        <DropdownMenuContent align="end" className={ICON_MENU_WIDTH}>
                          <DropdownMenuItem
                            disabled={!wsConnected}
                            onSelect={() => archiveBoard(b, false)}
                          >
                            <ArchiveRestore />
                            Restore board
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={!wsConnected}
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
            ) : null}
          </div>
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
          {snippetFocus !== null ? (
            <>
              <span className="min-w-0 flex-1 truncate text-violet-500">
                {focusedScreen?.name ?? snippetFocus}
              </span>
              <button
                type="button"
                onClick={() => setSnippetFocus(null)}
                className="shrink-0 normal-case tracking-normal hover:text-foreground"
                title="Stop editing this snippet (Esc)"
              >
                Done
              </button>
            </>
          ) : boardScreens.length > 1 ? (
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
            {treeScreen ? (
              <Tree key={treeScreen.id} screen={treeScreen} />
            ) : (
              <Empty className="px-4 py-2">
                <EmptyDescription className="text-xs">
                  Pick a screen above to see its tree.
                </EmptyDescription>
              </Empty>
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

      <Dialog
        open={groupDialog !== null}
        onOpenChange={(open) => {
          if (!open) setGroupDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {groupDialog?.mode === "rename" ? "Rename group" : "New group"}
            </DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitGroupDialog();
            }}
          >
            <Input
              autoFocus
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              maxLength={40}
              placeholder="Group name"
              aria-label="Group name"
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setGroupDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={groupName.trim().length === 0}>
                {groupDialog?.mode === "rename" ? "Rename" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingGroupDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingGroupDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete group</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingGroupDelete
                ? `Delete the group "${pendingGroupDelete.name}"? Its boards aren't deleted — they move to Ungrouped.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDeleteGroup}>
              Delete group
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                ? `Delete board "${pendingBoardDelete.name}"? Screens only this board places are deleted with it. Screens another board also places are kept.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDeleteBoard}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface GroupHeaderProps {
  group: BoardGroupMeta;
  count: number;
  collapsed: boolean;
  /** True while a dragged board would land in this group. */
  dropTarget: boolean;
  disabled: boolean;
  onToggle: () => void;
  onDragOver: (e: DragEvent<HTMLLIElement>) => void;
  onRename: () => void;
  onRecolor: (color: string) => void;
  onDelete: () => void;
}

/**
 * A sidebar group header: color chip, name, board count, and the group's own
 * menu. Doubles as a drop target — dragging a board onto it files the board.
 */
function GroupHeader({
  group,
  count,
  collapsed,
  dropTarget,
  disabled,
  onToggle,
  onDragOver,
  onRename,
  onRecolor,
  onDelete,
}: GroupHeaderProps) {
  return (
    <li
      onDragOver={onDragOver}
      className={`group/gr relative flex items-center rounded-md pr-7 ${dropTarget ? "bg-accent" : ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-muted"
      >
        {collapsed ? (
          <ChevronRight size={12} strokeWidth={2.5} className="shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown size={12} strokeWidth={2.5} className="shrink-0 text-muted-foreground" />
        )}
        <span
          className="size-2.5 shrink-0 rounded-[3px]"
          style={{ backgroundColor: group.color ?? "var(--muted-foreground)" }}
        />
        <span className="truncate text-xs font-semibold">{group.name}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{count}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            title="Group menu"
            className="absolute right-1 top-1.5 opacity-0 group-hover/gr:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={ICON_MENU_WIDTH}>
          <DropdownMenuItem disabled={disabled} onSelect={onRename}>
            <Pencil />
            Rename group
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={disabled}>
              <Palette />
              Color
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {GROUP_COLORS.map(({ value, label }) => (
                <DropdownMenuItem key={value} onSelect={() => onRecolor(value)}>
                  <span className="size-3 rounded-[3px]" style={{ backgroundColor: value }} />
                  {label}
                  {group.color === value ? <Check className="ml-auto" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem variant="destructive" disabled={disabled} onSelect={onDelete}>
            <Trash2 />
            Delete group
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
