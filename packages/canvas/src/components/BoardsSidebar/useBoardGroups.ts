import { useState } from "react";
import { type BoardGroupMeta, mutate } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { pushToast, toastError } from "../../toast.ts";

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

// Create and rename share one dialog, same as boards. `boardId` carries the
// board waiting to be filed when the group is created from its menu.
type GroupDialog = { mode: "create"; boardId?: string } | { mode: "rename"; groupId: string };

/** The sidebar's board groups: collapse state, the name dialog, recolor and delete. */
export function useBoardGroups() {
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsedGroups);
  const [dialog, setDialog] = useState<GroupDialog | null>(null);
  const [name, setName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<BoardGroupMeta | null>(null);

  const toggle = (groupId: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId];
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(next));
      }
      return next;
    });
  };

  const openDialog = (
    request: { mode: "create"; boardId?: string } | { mode: "rename"; group: BoardGroupMeta },
  ) => {
    if (request.mode === "create") {
      setName("New group");
      setDialog({ mode: "create", ...(request.boardId ? { boardId: request.boardId } : {}) });
    } else {
      setName(request.group.name);
      setDialog({ mode: "rename", groupId: request.group.id });
    }
  };

  const submitDialog = async () => {
    const trimmed = name.trim();
    if (!trimmed || !dialog) return;
    const current = dialog;
    setDialog(null);
    try {
      if (current.mode === "rename") {
        await mutate.updateBoardGroup({ groupId: current.groupId, patch: { name: trimmed } });
      } else if (current.boardId) {
        // Creating from a board's "New group…" both creates and files it —
        // `group` takes a name and creates on miss, so one call does both.
        await mutate.updateBoard({ boardId: current.boardId, patch: { group: trimmed } });
      } else {
        await mutate.addBoardGroup({ name: trimmed });
      }
      await useCanvas.getState().refreshDesignSummary();
    } catch (err) {
      toastError(err, current.mode === "rename" ? "Could not rename group" : "Could not add group");
    }
  };

  const recolor = (groupId: string, color: string) => {
    void mutate
      .updateBoardGroup({ groupId, patch: { color } })
      .then(() => useCanvas.getState().refreshDesignSummary())
      .catch((err: unknown) => toastError(err, "Could not recolor group"));
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const { id, name: groupName } = pendingDelete;
    setPendingDelete(null);
    void (async () => {
      try {
        const r = await mutate.removeBoardGroup({ groupId: id });
        await useCanvas.getState().refreshDesignSummary();
        const moved = r.ungroupedBoardIds.length;
        pushToast({
          kind: "info",
          message:
            moved > 0
              ? `Deleted "${groupName}" — ${moved} board${moved === 1 ? "" : "s"} moved to Ungrouped`
              : `Deleted "${groupName}"`,
        });
      } catch (err) {
        toastError(err, "Could not delete group");
      }
    })();
  };

  return {
    collapsed,
    toggle,
    dialog,
    name,
    setName,
    openDialog,
    closeDialog: () => setDialog(null),
    submitDialog,
    recolor,
    pendingDelete,
    requestDelete: setPendingDelete,
    cancelDelete: () => setPendingDelete(null),
    confirmDelete,
  };
}
