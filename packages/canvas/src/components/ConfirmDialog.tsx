import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

/**
 * Minimal modal confirmation. Renders a backdrop + centered card; Enter
 * confirms, Esc cancels. Used for destructive actions (delete page, delete
 * variant) where the native confirm() dialog felt out of place.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      } else if (e.key === "Enter") {
        e.stopPropagation();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="velloo-confirm-title"
        className="relative w-[24rem] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
      >
        <div className="px-5 pt-4 pb-2">
          <h2 id="velloo-confirm-title" className="text-sm font-semibold text-[var(--color-fg)]">
            {title}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{body}</p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-7 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-xs text-[var(--color-fg)] hover:bg-[var(--color-surface)]"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={
              "h-7 rounded px-3 text-xs font-medium " +
              (destructive
                ? "bg-[var(--color-destructive,red)] text-white hover:opacity-90"
                : "bg-[var(--color-fg)] text-[var(--color-bg)] hover:opacity-90")
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
