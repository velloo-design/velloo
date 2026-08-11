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
  /** True when any variant on the page has an explicit position. */
  positioned: boolean;
}

export function VariantFrame({ pageId, variantId, variantName, viewport, positioned }: Props) {
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

  const commitViewport = (next: { w: number; h: number }) => {
    setEditingSize(false);
    if (next.w === viewport.w && next.h === viewport.h) return;
    void mutate
      .updateVariant({ pageId, variantId, patch: { viewport: next } })
      .catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-2 shrink-0" style={{ width: viewport.w }}>
      {/* Header — grabbable handle when positioned mode is on. The
       * `velloo-variant-header` class is used by VariantGrid's drag handler
       * to start a drag on mousedown anywhere in the header. */}
      <div
        className={
          "flex items-baseline gap-2 px-1 text-xs text-[var(--color-fg-muted)] velloo-variant-header" +
          (positioned ? " cursor-grab active:cursor-grabbing" : "")
        }
        data-variant-id={variantId}
      >
        <span className="font-medium text-[var(--color-fg)]">{variantName}</span>
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
