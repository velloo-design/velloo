import { useState } from "react";
import { type RevertStatus, revertAll } from "../api.ts";
import { pushToast, toastError } from "../toast.ts";
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

const STATUS_LABEL: Record<string, string> = {
  modified: "modified",
  added: "added",
  deleted: "deleted",
  untracked: "new",
};

interface Props {
  /** Pre-fetched status (the menu fetched it to decide enablement); null = closed. */
  status: RevertStatus | null;
  onClose: () => void;
}

/**
 * Confirmation for the git-backed revert-all: lists exactly which
 * design files will be restored/removed before anything happens. The server
 * runs the revert under the mutation locks, clears undo history, reloads the
 * folder, and broadcasts `folder-reloaded` so every canvas refetches.
 */
export function RevertDialog({ status, onClose }: Props) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      const r = await revertAll();
      pushToast({
        kind: "success",
        message: `Reverted ${r.reverted} file${r.reverted === 1 ? "" : "s"} to the last commit.`,
      });
      onClose();
    } catch (err) {
      toastError(err, "Revert failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={status !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revert all design changes</AlertDialogTitle>
          <AlertDialogDescription>
            {status
              ? `Restore the design folder to its last git commit. ${status.files.length} file${
                  status.files.length === 1 ? "" : "s"
                } will be reverted — new files are deleted, edits are discarded. This also clears the undo history and cannot be undone from the canvas.`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {status && status.files.length > 0 ? (
          <ul className="max-h-48 overflow-y-auto scroll-stable rounded-md border bg-muted/30 p-2 text-xs font-mono">
            {status.files.map((f) => (
              <li key={f.path} className="flex items-center justify-between gap-3 py-0.5">
                <span className="truncate">{f.path}</span>
                <span className="shrink-0 text-muted-foreground">
                  {STATUS_LABEL[f.status] ?? f.status}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(e) => {
              // Keep the dialog open while the revert runs; close on success.
              e.preventDefault();
              void confirm();
            }}
          >
            {busy ? "Reverting…" : "Revert everything"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
