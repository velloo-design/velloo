import { GripVertical, MoreHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { mutate, renderUrl } from "../api.ts";
import { IframeChannel } from "../iframe-channel.ts";
import { useCanvas } from "../store.ts";
import { ViewportEditor } from "./ViewportEditor.tsx";

interface Props {
  pageId: string;
  variantId: string;
  variantName: string;
  viewport: { w: number; h: number };
}

export function VariantFrame({ pageId, variantId, variantName, viewport }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const channelRef = useRef<IframeChannel | null>(null);
  const setSelection = useCanvas((s) => s.setSelection);
  const setHover = useCanvas((s) => s.setHover);
  const pageVersion = useCanvas((s) => s.pageVersion);
  const selection = useCanvas((s) => (s.selection?.variantId === variantId ? s.selection : null));
  const hover = useCanvas((s) => (s.hover?.variantId === variantId ? s.hover : null));

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;

    const handleLoad = () => {
      channelRef.current?.destroy();
      const channel = new IframeChannel(iframe, {
        onSelect: (path) => {
          if (path === null) setSelection(null);
          else setSelection({ variantId, path });
        },
        onHover: (path) => {
          if (path === null) setHover(null);
          else setHover({ variantId, path });
        },
      });
      channel.attach();
      channelRef.current = channel;
      const sel = useCanvas.getState().selection;
      if (sel?.variantId === variantId) {
        channel.send({ type: "applyHighlight", path: sel.path });
      }
    };

    iframe.addEventListener("load", handleLoad);
    return () => {
      iframe.removeEventListener("load", handleLoad);
      channelRef.current?.destroy();
      channelRef.current = null;
    };
  }, [variantId, setSelection, setHover]);

  useEffect(() => {
    const ch = channelRef.current;
    if (!ch) return;
    if (selection) ch.send({ type: "applyHighlight", path: selection.path });
    else ch.send({ type: "clearHighlight" });
  }, [selection]);

  useEffect(() => {
    const ch = channelRef.current;
    if (!ch) return;
    if (hover) ch.send({ type: "applyHover", path: hover.path });
    else ch.send({ type: "clearHover" });
  }, [hover]);

  const nodeState = useCanvas((s) => s.nodeState);
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch) return;
    const path = selection?.path ?? null;
    ch.send({ type: "applyVelloState", path, state: nodeState });
  }, [nodeState, selection]);

  const src = `${renderUrl(pageId, variantId)}?v=${pageVersion}`;

  const [editingSize, setEditingSize] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const commitViewport = (next: { w: number; h: number }) => {
    setEditingSize(false);
    if (next.w === viewport.w && next.h === viewport.h) return;
    void mutate
      .updateVariant({ pageId, variantId, patch: { viewport: next } })
      .catch(() => undefined);
  };

  const onDelete = () => {
    setMenuOpen(false);
    if (!confirm(`Delete variant "${variantName}"?`)) return;
    void mutate.removeVariant({ pageId, variantId }).catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-2 shrink-0 group/frame" style={{ width: viewport.w }}>
      {/* Header — drag handle on the left, delete menu on the right. The
       * `.velloo-variant-handle` class is the *only* element VariantGrid's
       * drag handler accepts; the rest of the header is for inspection. */}
      <div
        className="flex items-center gap-2 px-1 text-xs text-[var(--color-fg-muted)] velloo-variant-header"
        data-variant-id={variantId}
      >
        <span
          className="velloo-variant-handle inline-flex items-center justify-center text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] cursor-grab active:cursor-grabbing -ml-1"
          title="Drag to reposition"
          data-variant-id={variantId}
        >
          <GripVertical size={14} strokeWidth={2} />
        </span>
        <span className="font-medium text-[var(--color-fg)] truncate">{variantName}</span>
        {editingSize ? (
          <ViewportEditor
            initial={viewport}
            onCommit={commitViewport}
            onCancel={() => setEditingSize(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingSize(true)}
            className="cursor-text hover:text-[var(--color-fg)] tabular-nums"
            title="Click to edit viewport"
          >
            {viewport.w} × {viewport.h}
          </button>
        )}
        <div className="ml-auto relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            title="Variant menu"
            className={
              "h-5 w-5 grid place-items-center rounded text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg)] " +
              (menuOpen ? "opacity-100" : "opacity-0 group-hover/frame:opacity-100")
            }
          >
            <MoreHorizontal size={14} strokeWidth={2} />
          </button>
          {menuOpen ? (
            <>
              {/* Click-outside backdrop */}
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div className="absolute right-0 top-6 z-50 w-36 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-md py-1 text-sm">
                <button
                  type="button"
                  onClick={onDelete}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--color-destructive,red)] hover:bg-[var(--color-bg)]"
                >
                  <Trash2 size={13} strokeWidth={2} />
                  Delete variant
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
      <div
        className="bg-white border border-[var(--color-border)] rounded-md shadow-sm overflow-hidden"
        style={{ width: viewport.w, height: viewport.h }}
      >
        <iframe
          ref={iframeRef}
          title={`${pageId} / ${variantName}`}
          src={src}
          className="w-full h-full block velloo-frame-iframe"
          sandbox="allow-same-origin allow-scripts"
        />
      </div>
    </div>
  );
}
