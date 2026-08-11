import { useEffect, useRef } from "react";
import { renderUrl } from "../api.ts";
import { IframeChannel } from "../iframe-channel.ts";
import { useCanvas } from "../store.ts";

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

      // Re-apply current highlight after the iframe reloads (the channel
      // buffers until handshake completes, so this is safe pre-ready).
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

  // Push current selection / hover into the iframe whenever they change.
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

  // Push the forced node state (Inspector "Preview state" dropdown) into the
  // iframe. Only applies when the selection lives in this variant.
  const nodeState = useCanvas((s) => s.nodeState);
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch) return;
    const path = selection?.path ?? null;
    ch.send({ type: "applyVelloState", path, state: nodeState });
  }, [nodeState, selection]);

  // Cache-bust the iframe src on page-version bumps so the iframe reloads
  // with fresh HTML after server-side mutations.
  const src = `${renderUrl(pageId, variantId)}?v=${pageVersion}`;

  return (
    <div className="flex flex-col gap-2 shrink-0">
      <div className="flex items-baseline gap-2 px-1 text-xs text-[var(--color-fg-muted)]">
        <span className="font-medium text-[var(--color-fg)]">{variantName}</span>
        <span>
          {viewport.w} × {viewport.h}
        </span>
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
