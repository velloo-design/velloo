import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { SnippetMeta } from "../api.ts";
import { useCanvas } from "../store.ts";

interface Props {
  open: boolean;
  snippet: SnippetMeta | null;
  /** Insert at this label so the user knows where it lands. */
  insertHint: string;
  onConfirm(): void;
  onCancel(): void;
}

/**
 * Modal that previews a snippet at a comfortable size + shows its
 * param contract before the user commits. Click-through used to insert
 * immediately and the user had to spot the new node at the bottom of
 * the tree — easy to miss, easy to undo. The preview makes the
 * "what is this thing?" question answerable in the canvas.
 *
 * The render iframe inside the dialog hits the same
 * `/api/render/snippet/<id>` route the sidebar thumbnails use, so
 * required params fill with their placeholder values server-side.
 */
export function SnippetPreviewDialog({ open, snippet, insertHint, onConfirm, onCancel }: Props) {
  const screenVersion = useCanvas((s) => s.screenVersion);
  const themeVersion = useCanvas((s) => s.themeVersion);

  useEffect(() => {
    if (!open) return;
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

  if (!open || !snippet || typeof document === "undefined") return null;

  // 720×420 fits cards, hero rows, and sidebar items comfortably.
  const previewW = 720;
  const previewH = 420;

  return createPortal(
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
        aria-labelledby="velloo-snippet-preview-title"
        className="relative flex w-[44rem] flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl"
      >
        <header className="flex items-baseline justify-between gap-3">
          <h2
            id="velloo-snippet-preview-title"
            className="text-sm font-semibold text-[var(--color-fg)]"
          >
            {snippet.name}
          </h2>
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)]">
            snippet · {snippet.params.length} param{snippet.params.length === 1 ? "" : "s"}
          </span>
        </header>

        <div className="overflow-hidden rounded-md border border-[var(--color-border)] bg-white">
          <iframe
            // Half-scale so a 720×420 effective tile renders 1440×840
            // pixels of design — leaves room for cards/rows without
            // truncation.
            src={`/api/render/snippet/${encodeURIComponent(snippet.id)}?w=${previewW * 2}&h=${previewH * 2}&v=${themeVersion}.${screenVersion}`}
            title={`${snippet.name} preview`}
            className="pointer-events-none origin-top-left"
            style={{
              transform: "scale(0.5)",
              width: `${previewW * 2}px`,
              height: `${previewH * 2}px`,
            }}
          />
        </div>

        {snippet.params.length > 0 ? (
          <div className="flex flex-col gap-1">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)]">
              Params (defaults will be filled — edit in inspector after inserting)
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {snippet.params.map((p) => (
                <li
                  key={p.name}
                  className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-[10px] tabular-nums"
                  title={
                    p.default !== undefined ? `default: ${JSON.stringify(p.default)}` : "required"
                  }
                >
                  <span className="font-medium text-[var(--color-fg)]">{p.name}</span>
                  <span className="ml-1 text-[var(--color-fg-muted)]">{p.type}</span>
                  {p.default === undefined ? (
                    <span className="ml-1 text-[var(--color-accent)]">*</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
          <span className="text-[10px] text-[var(--color-fg-muted)]">
            Insert under: <span className="text-[var(--color-fg)]">{insertHint}</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="h-7 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-xs text-[var(--color-fg)] hover:bg-[var(--color-surface)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="h-7 rounded bg-[var(--color-accent)] px-3 text-xs font-medium text-[var(--color-accent-fg)] hover:opacity-90"
            >
              Insert
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
