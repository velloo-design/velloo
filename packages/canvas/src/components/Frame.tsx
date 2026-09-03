import type { Frame as FrameT, ViewportPreset } from "@velloo/schema";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { mutate } from "../api.ts";
import { wheelZoomFactor, zoomAtPoint } from "../board-geometry.ts";
import { fontDraftCss, fontDraftUrl } from "../font-draft.ts";
import { frameRenderSrc } from "../frame-render-src.ts";
import { IframeChannel } from "../iframe-channel.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { typesetDraftCss } from "../typeset-draft.ts";
import { FrameHeader } from "./Frame/FrameHeader.tsx";
import { FrameViewportPresets } from "./Frame/FrameViewportPresets.tsx";
import { useFrameInteractions } from "./Frame/useFrameInteractions.ts";
import { Loading } from "./Loading.tsx";
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

interface FrameProps {
  boardId: string;
  frame: FrameT;
  /**
   * The board's full frame list (stable per design refresh). The collision
   * set is derived here rather than passed pre-filtered so Board's props stay
   * referentially stable and `memo` can skip Frames on pan/zoom ticks.
   */
  frames: FrameT[];
  presets: ViewportPreset[];
  sharedCount: number;
}

/**
 * One placement on the Board: an iframe at the frame's chosen size, rendering
 * the referenced screen. Grab the header to drag; pull the edge handles to
 * resize. Resize clamps against neighboring frames so they never overlap.
 *
 * When the canvas cursor is in `hand` or `note` mode, the iframe's
 * pointer-events are disabled so the parent can capture drag/click through
 * the frame.
 *
 * Memoized: pan/zoom ticks re-render only Board's transform wrapper, so a
 * Frame reconciles only when its own props or store subscriptions change.
 */
export const Frame = memo(function Frame({
  boardId,
  frame,
  frames,
  presets,
  sharedCount,
}: FrameProps) {
  const otherFrames = useMemo(() => frames.filter((f) => f.id !== frame.id), [frames, frame.id]);
  const slotARef = useRef<HTMLIFrameElement>(null);
  const slotBRef = useRef<HTMLIFrameElement>(null);
  const chromeHostRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<IframeChannel | null>(null);
  const screen = useCanvas((s) => s.screens[frame.screen]);
  const boardTheme = useCanvas((s) => s.boards[boardId]?.theme);
  const screenVersion = useCanvas((s) => s.screenVersion);
  // Per-screen version for the iframe cache-buster — editing another screen
  // must not reload this frame's iframe (only its own screen's edits should).
  const screenRev = useCanvas((s) => s.screenVersions[frame.screen] ?? 0);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const selection = useCanvas((s) => s.selection);
  const hover = useCanvas((s) => s.hover);
  const reveal = useCanvas((s) => s.reveal);
  const nodeState = useCanvas((s) => s.nodeState);
  const designMode = useCanvas((s) => s.designMode);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const wsConnected = useCanvas((s) => s.wsConnected);
  const setSelection = useCanvas((s) => s.setSelection);
  const setHover = useCanvas((s) => s.setHover);
  const setNodeRects = useCanvas((s) => s.setNodeRects);
  const clearNodeRects = useCanvas((s) => s.clearNodeRects);
  const setFrameInset = useCanvas((s) => s.setFrameInset);
  const annotations = useCanvas((s) => s.annotations);
  const activityFlash = useCanvas((s) => s.activityFlash[frame.screen]);
  const glowNonce = useCanvas((s) => s.frameGlow[frame.id]);
  const [glowing, setGlowing] = useState(false);

  const { draftPos, draftSize, startDrag, startResize } = useFrameInteractions({
    boardId,
    frame,
    otherFrames,
  });

  const w = draftSize?.w ?? frame.w;
  const h = draftSize?.h ?? frame.h;
  const x = draftPos?.x ?? frame.x;
  const y = draftPos?.y ?? frame.y;
  const hasScreen = Boolean(screen);

  // The iframe src embeds only *committed* frame size — draft (mid-drag)
  // sizes stretch the element visually via width/height styling, so a resize
  // gesture doesn't navigate the iframe on every pointer-move tick; the one
  // reload happens on commit. While the daemon is unreachable the
  // src is frozen entirely: recomputing it (theme toggle, version bumps,
  // attempted resizes) would point the iframe at an unreachable /api/render
  // URL and blank the frame to gray.
  const computedSrc = frameRenderSrc({
    frame,
    canvasDefault: designMode,
    ...(boardTheme ? { boardTheme } : {}),
    screenRevision: screenRev,
    themeVersion,
  });
  const frozenSrcRef = useRef(computedSrc);
  if (wsConnected) frozenSrcRef.current = computedSrc;
  const src = frozenSrcRef.current;

  // Last scroll offset the iframe reported — restored in onReady after a
  // reload so theme toggles/edits and resize commits keep the user's place.
  const savedScrollRef = useRef<{ x: number; y: number } | null>(null);

  // Double-buffered iframes: a src change is a full navigation, and a single
  // iframe blanks white while the new document loads — every edit flickered.
  // Instead the new src loads in a hidden back buffer and the slots swap on
  // its `load`, so the previous render stays painted throughout.
  const [buffers, setBuffers] = useState<{ srcs: [string | null, string | null]; front: 0 | 1 }>(
    () => ({ srcs: [src, null], front: 0 }),
  );
  const buffersRef = useRef(buffers);
  buffersRef.current = buffers;
  const front = buffers.front;
  const frontRef = front === 0 ? slotARef : slotBRef;

  useEffect(() => {
    setBuffers((b) => {
      const back = (1 - b.front) as 0 | 1;
      if (b.srcs[b.front] === src) {
        // Desired src already visible — drop any stale in-flight back load.
        if (b.srcs[back] === null) return b;
        const srcs: [string | null, string | null] = [...b.srcs];
        srcs[back] = null;
        return { ...b, srcs };
      }
      if (b.srcs[back] === src) return b;
      const srcs: [string | null, string | null] = [...b.srcs];
      srcs[back] = src;
      return { ...b, srcs };
    });
  }, [src]);

  const onSlotLoad = (slot: 0 | 1) => {
    const b = buffersRef.current;
    if (slot === b.front) {
      // First paint of the visible slot (initial mount) — start the handshake.
      channelRef.current?.attach();
      return;
    }
    if (b.srcs[slot] === null) return;
    // Same-origin: put the fresh document at the saved scroll offset *before*
    // it becomes visible, so the swap can't flash the top of the screen.
    const saved = savedScrollRef.current;
    const win = (slot === 0 ? slotARef : slotBRef).current?.contentWindow;
    if (saved && win) win.scrollTo(saved.x, saved.y);
    setBuffers(
      slot === 0 ? { srcs: [b.srcs[0], null], front: 0 } : { srcs: [null, b.srcs[1]], front: 1 },
    );
  };

  // Measure the frame chrome instead of hardcoding its layout: the iframe's
  // offset from the frame origin (header row above) feeds annotation
  // anchoring, and the total vertical chrome feeds frame collision. The
  // ResizeObserver keeps the numbers true through chrome edits — label
  // wrapping, new badges, restyled headers.
  useEffect(() => {
    void hasScreen; // the measured host only exists once the screen loaded
    const host = chromeHostRef.current;
    if (!host) return;
    const column = host.parentElement;
    const report = () => {
      setFrameInset(frame.id, {
        x: host.offsetLeft,
        y: host.offsetTop,
        chromeH: (column?.offsetHeight ?? host.offsetHeight) - host.offsetHeight,
      });
    };
    report();
    const ro = new ResizeObserver(report);
    if (column) ro.observe(column);
    ro.observe(host);
    return () => {
      ro.disconnect();
      setFrameInset(frame.id, null);
    };
  }, [frame.id, hasScreen, setFrameInset]);

  useEffect(() => {
    void hasScreen; // re-run once the screen loads so a late-mounted iframe attaches
    const iframe = frontRef.current;
    if (!iframe) return;
    const channel = new IframeChannel(iframe, {
      onSelect(path) {
        if (path === null) setSelection(null);
        else setSelection({ screenId: frame.screen, path });
      },
      onHover(path) {
        if (path === null) setHover(null);
        else setHover({ screenId: frame.screen, path });
      },
      onRects(rects) {
        setNodeRects(frame.id, rects);
      },
      // A reloaded iframe (screenVersion bump after an edit, HMR) comes up
      // with a blank document while the store still holds selection/hover —
      // and the effects below are keyed on those values, so nothing re-sends
      // them. Re-establish everything the parent believes is true, and
      // re-request annotation rects so anchors track the fresh layout.
      onScrollPos(sx, sy) {
        savedScrollRef.current = { x: sx, y: sy };
      },
      onReady() {
        const s = useCanvas.getState();
        // Restore the pre-reload scroll offset — unless a reveal jump is
        // pending for this screen, whose scrollIntoView must win.
        const revealPending = s.reveal?.screenId === frame.screen;
        if (!revealPending && savedScrollRef.current) {
          channel.send({ type: "restoreScroll", ...savedScrollRef.current });
        }
        if (s.selection?.screenId === frame.screen) {
          // A pending reveal means this selection came from a search jump and
          // the iframe just (re)loaded — scroll the node into view too.
          const scroll = s.reveal?.screenId === frame.screen && s.reveal.path === s.selection.path;
          channel.send({
            type: "applyHighlight",
            path: s.selection.path,
            ...(scroll ? { scroll } : {}),
          });
        }
        if (s.hover?.screenId === frame.screen) {
          channel.send({ type: "applyHover", path: s.hover.path });
        }
        if (s.nodeState !== "default" && s.selection?.screenId === frame.screen) {
          channel.send({ type: "applyVelloState", path: s.selection.path, state: s.nodeState });
        }
        const annotated = s.annotations
          .filter((a) => a.screenId === frame.screen && a.resolved !== null)
          .map((a) => (a.resolved ?? []).join("."));
        if (annotated.length > 0) {
          channel.send({ type: "requestRects", paths: annotated });
        }
      },
      // Cmd/Ctrl + wheel inside the iframe → zoom the board. Same
      // factor as Board.tsx's own onWheel handler so the two routes
      // feel identical. clientX/Y are inside the iframe document; we
      // translate them to board-wrapper coords using the iframe's
      // bounding rect so zoom anchors on the cursor instead of (0,0).
      onParentZoom(deltaY, clientX, clientY) {
        const state = useCanvas.getState();
        const factor = wheelZoomFactor(deltaY);
        const iframeEl = iframe;
        const wrapper = iframeEl?.closest<HTMLDivElement>('[data-velloo-board="true"]');
        if (!iframeEl || !wrapper) {
          state.zoomAtViewportCenter({ factor });
          return;
        }
        const iframeRect = iframeEl.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        // Map iframe-local client coords into wrapper space. Prefer the
        // live element scale (rect/clientWidth) over store zoom — they can
        // diverge mid-flight during animated camera moves.
        const scaleX =
          iframeEl.clientWidth > 0 ? iframeRect.width / iframeEl.clientWidth : state.canvasZoom;
        const scaleY =
          iframeEl.clientHeight > 0 ? iframeRect.height / iframeEl.clientHeight : state.canvasZoom;
        const anchorX = iframeRect.left - wrapperRect.left + clientX * scaleX;
        const anchorY = iframeRect.top - wrapperRect.top + clientY * scaleY;
        const next = zoomAtPoint(anchorX, anchorY, factor, {
          zoom: state.canvasZoom,
          pan: state.pan,
        });
        if (next.zoom === state.canvasZoom) return;
        state.setCanvasZoom(next.zoom);
        state.setPan(next.pan);
      },
      // Plain wheel/trackpad inside the iframe → pan the board. Matches
      // the parent board's own onWheel handler so panning feels the
      // same whether the cursor sits over a frame or the grid.
      onParentPan(deltaX, deltaY) {
        const state = useCanvas.getState();
        state.setPan({ x: state.pan.x - deltaX, y: state.pan.y - deltaY });
      },
    });
    channelRef.current = channel;
    // Already loaded — the common case: a freshly promoted back buffer, or a
    // hot-reload remount. The initial front load instead lands in onSlotLoad.
    if (iframe.contentDocument?.readyState === "complete") channel.attach();
    return () => {
      channel.destroy();
      channelRef.current = null;
      clearNodeRects(frame.id);
    };
    // hasScreen: a frame added to an open board first mounts as the "Loading…"
    // placeholder (iframe null); re-run once the screen loads so the channel
    // actually attaches and the frame becomes selectable. frontRef flips
    // between the two slot refs on every buffer swap, re-binding the channel
    // to the newly visible document.
  }, [
    frame.id,
    frame.screen,
    hasScreen,
    frontRef,
    setSelection,
    setHover,
    setNodeRects,
    clearNodeRects,
  ]);

  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    if (selection?.screenId === frame.screen) {
      channel.send({ type: "applyHighlight", path: selection.path });
    } else {
      channel.send({ type: "clearHighlight" });
    }
  }, [selection, frame.screen]);

  // Annotate mode needs a pick-target cursor *inside* the iframe — parent CSS
  // can't style cross-document content, so inject a style tag into the doc.
  // biome-ignore lint/correctness/useExhaustiveDependencies: front/screenRev/hasScreen re-apply the style after iframe swaps/reloads
  useEffect(() => {
    const apply = (iframe: HTMLIFrameElement | null) => {
      const doc = iframe?.contentDocument;
      if (!doc?.head) return;
      const id = "__velloo-annotate-cursor";
      let el = doc.getElementById(id);
      if (cursorMode === "annotate") {
        if (!el) {
          el = doc.createElement("style");
          el.id = id;
          doc.head.appendChild(el);
        }
        el.textContent = "*, *::before, *::after { cursor: cell !important; }";
      } else if (el) {
        el.remove();
      }
    };
    apply(slotARef.current);
    apply(slotBRef.current);
  }, [cursorMode, front, screenRev, hasScreen]);

  // Live theme preview: while a rhythm control is being dragged or a family is
  // highlighted in the font browser, paint the uncommitted values straight into
  // this frame's document as CSS-variable overrides. Same-origin, so it's a
  // direct style write rather than a channel message, and both the type ladder
  // and the font roles re-derive from those variables — the board re-rhythms or
  // re-faces continuously with no reload and no render.
  //
  // The override outlives the store draft by one document. A commit clears the
  // draft and bumps `themeVersion` in the same tick, and the reloaded document
  // takes a moment to arrive; dropping the override immediately would snap this
  // frame back to the pre-edit theme for exactly that long. So it is held while
  // a reload is in flight and released once the current document — which the
  // server rendered with the committed values — is the one on screen.
  const typesetDraft = useCanvas((s) => s.typesetDraft);
  const fontDraft = useCanvas((s) => s.fontDraft);
  const frontIsCurrent = buffers.srcs[front] === src;
  const heldDraftRef = useRef<{ css: string; fontUrl: string | null } | null>(null);
  if (typesetDraft || fontDraft) {
    const css = [
      typesetDraft ? typesetDraftCss(typesetDraft) : "",
      fontDraft ? fontDraftCss(fontDraft) : "",
    ]
      .filter(Boolean)
      .join("\n");
    heldDraftRef.current = { css, fontUrl: fontDraft ? fontDraftUrl(fontDraft) : null };
  } else if (frontIsCurrent) {
    heldDraftRef.current = null;
  }
  const draft = heldDraftRef.current;
  const draftCss = draft?.css ?? "";
  const draftFontUrl = draft?.fontUrl ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: front/screenRev/hasScreen re-apply the override after iframe swaps and reloads
  useEffect(() => {
    const apply = (iframe: HTMLIFrameElement | null) => {
      const doc = iframe?.contentDocument;
      if (!doc?.head) return;
      // The webfont link goes in first: the override naming the family is inert
      // until the face is actually being fetched.
      upsertHeadElement(doc, "__velloo-font-draft", "link", draftFontUrl, (el) => {
        const link = el as HTMLLinkElement;
        link.rel = "stylesheet";
        link.href = draftFontUrl as string;
      });
      upsertHeadElement(doc, "__velloo-theme-draft", "style", draftCss || null, (el) => {
        el.textContent = draftCss;
      });
    };
    apply(slotARef.current);
    apply(slotBRef.current);
  }, [draftCss, draftFontUrl, front, screenRev, hasScreen]);

  // Search jumps: scroll the revealed node into view inside the iframe (the
  // regular highlight effect above never scrolls — click selection is
  // already visible). Keyed on the reveal nonce so re-jumping to the same
  // node scrolls again after the user wandered off.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !reveal || reveal.screenId !== frame.screen) return;
    channel.send({ type: "applyHighlight", path: reveal.path, scroll: true });
  }, [reveal, frame.screen]);

  // Agent-activity node flash: a node an agent just touched pulses in
  // every frame showing that screen — no scroll, and the user's selection
  // highlight is restored (never stolen) when the pulse ends. The nonce
  // coalesces bursts: each bump extends the pulse instead of strobing.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !activityFlash || activityFlash.path === null) return;
    channel.send({ type: "applyHighlight", path: activityFlash.path });
    const timer = setTimeout(() => {
      const sel = useCanvas.getState().selection;
      if (sel?.screenId === frame.screen) {
        channel.send({ type: "applyHighlight", path: sel.path });
      } else {
        channel.send({ type: "clearHighlight" });
      }
    }, 1100);
    return () => clearTimeout(timer);
  }, [activityFlash, frame.screen]);

  // Frame-level glow for screen-, frame-, and theme-level agent ops.
  useEffect(() => {
    if (!glowNonce) return;
    setGlowing(true);
    const timer = setTimeout(() => setGlowing(false), 1400);
    return () => clearTimeout(timer);
  }, [glowNonce]);

  // One-shot geometry probe for fly-to-node navigation: answer with the
  // probed path's rect (plus the annotated paths, since a rects response
  // replaces this frame's whole registry entry).
  const rectProbe = useCanvas((s) => s.rectProbe);
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !rectProbe || rectProbe.frameId !== frame.id) return;
    const annotatedPaths = annotations
      .filter((a) => a.screenId === frame.screen && a.resolved !== null)
      .map((a) => (a.resolved ?? []).join("."));
    channel.send({
      type: "requestRects",
      paths: [...new Set([rectProbe.path, ...annotatedPaths])],
    });
  }, [rectProbe, frame.id, frame.screen, annotations]);

  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    if (hover?.screenId === frame.screen) {
      channel.send({ type: "applyHover", path: hover.path });
    } else {
      channel.send({ type: "clearHover" });
    }
  }, [hover, frame.screen]);

  // Force-state preview: when a node on this screen is selected and the
  // Inspector's State dropdown is off "default", drive the iframe to pin that
  // pseudo-state (the runtime sets [data-velloo-state], styled by the snapshot
  // CSS). Clears when nothing on this screen is selected or state is default.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    const path = selection?.screenId === frame.screen ? selection.path : null;
    channel.send({ type: "applyVelloState", path, state: path ? nodeState : "default" });
  }, [nodeState, selection, frame.screen]);

  // Ask the iframe to report rects for every annotated path on this
  // screen. The channel buffers until handshake completes; once the
  // iframe re-renders (screenVersion bump), we re-request so the rects
  // stay fresh after edits. AnnotationsLayer reads what comes back and
  // anchors each annotation to the actual node geometry.
  useEffect(() => {
    void screenVersion;
    const channel = channelRef.current;
    if (!channel) return;
    const annotatedPaths = annotations
      .filter((a) => a.screenId === frame.screen && a.resolved !== null)
      .map((a) => (a.resolved ?? []).join("."));
    if (annotatedPaths.length === 0) {
      clearNodeRects(frame.id);
      return;
    }
    channel.send({ type: "requestRects", paths: annotatedPaths });
  }, [annotations, frame.id, frame.screen, screenVersion, clearNodeRects]);

  const onPickPreset = (preset: ViewportPreset) => {
    if (preset.w === frame.w && preset.h === frame.h) return;
    void mutate
      .updateFrame({ boardId, frameId: frame.id, patch: { w: preset.w, h: preset.h } })
      .catch((err) => toastError(err, "Could not resize frame"));
  };

  const [confirmRemove, setConfirmRemove] = useState(false);

  const onRemove = () => setConfirmRemove(true);

  const doRemove = () => {
    setConfirmRemove(false);
    void mutate
      .removeFrame({ boardId, frameId: frame.id })
      .catch((err) => toastError(err, "Could not remove frame"));
  };

  const onResize = (patch: { w?: number; h?: number }) => {
    void mutate
      .updateFrame({ boardId, frameId: frame.id, patch })
      .catch((err) => toastError(err, "Could not resize frame"));
  };

  const onSchemeChange = (scheme: "light" | "dark" | null) => {
    void mutate
      .updateFrame({ boardId, frameId: frame.id, patch: { scheme } })
      .catch((err) => toastError(err, "Could not update frame color scheme"));
  };

  const onExport = () => {
    useCanvas.getState().setExportTarget({
      kind: "frame",
      id: frame.id,
      name: frame.label ?? screen?.name ?? frame.screen,
    });
  };

  const onPreview = () => {
    useCanvas.getState().setPreviewTarget({
      screenId: frame.screen,
      name: frame.label ?? screen?.name ?? frame.screen,
      ...(boardTheme ? { boardTheme } : {}),
      ...(frame.scheme ? { scheme: frame.scheme } : {}),
      w: frame.w,
    });
  };

  // Sibling frame of the same screen at a chosen size — auto-positioned by
  // the server (right of the rightmost frame). Multiple frames of one screen
  // edit-sync by design, so this is the "desktop/tablet/mobile side by side"
  // affordance.
  const onAddSibling = (size: { w: number; h: number }) => {
    void mutate
      .addFrame({ boardId, screenId: frame.screen, w: size.w, h: size.h })
      .catch((err) => toastError(err, "Could not add frame"));
  };

  const passThrough = cursorMode === "hand" || cursorMode === "note";

  return (
    <div
      className="absolute group"
      style={{ left: x, top: y }}
      data-frame-id={frame.id}
      data-group-id={frame.group ?? ""}
    >
      <div className="flex flex-col gap-1">
        {/*
          Counter-scale the chrome against the board zoom so the title, size
          inputs, and menu render at a constant, readable size. The layout box
          is sized to w×zoom and scaled back by 1/zoom, so the visual width
          always matches the frame; origin bottom-left grows the row upward,
          away from the iframe.
        */}
        <div
          style={{
            width: `calc(${w}px * var(--canvas-zoom, 1))`,
            transform: "scale(calc(1 / var(--canvas-zoom, 1)))",
            transformOrigin: "bottom left",
          }}
        >
          <FrameHeader
            label={frame.label ?? screen?.name ?? frame.screen}
            w={w}
            h={h}
            sharedCount={sharedCount}
            library={screen?.library ?? null}
            presets={presets}
            scheme={frame.scheme}
            canvasDefault={designMode}
            onPointerDownGrip={startDrag}
            onRemove={onRemove}
            onExport={onExport}
            onResize={onResize}
            onPreview={onPreview}
            onAddSibling={onAddSibling}
            onSchemeChange={onSchemeChange}
          />
        </div>

        {!screen ? (
          <div
            style={{ width: w, height: h }}
            className="border border-dashed border-muted-foreground/30 rounded-md grid place-items-center text-xs text-muted-foreground"
          >
            <Loading size={28} label={frame.screen} className="flex-col" />
          </div>
        ) : (
          <div
            ref={chromeHostRef}
            className={
              "relative" +
              (glowing
                ? " rounded-md ring-2 ring-primary/70 shadow-[0_0_18px_2px] shadow-primary/25 transition-shadow duration-300"
                : "")
            }
            style={{ width: w, height: h }}
          >
            {([0, 1] as const).map((slot) =>
              buffers.srcs[slot] === null ? null : (
                <iframe
                  key={slot}
                  ref={slot === 0 ? slotARef : slotBRef}
                  title={`${screen.name} (${frame.id})${slot === front ? "" : " — loading"}`}
                  src={buffers.srcs[slot] as string}
                  width={w}
                  height={h}
                  onLoad={() => onSlotLoad(slot)}
                  aria-hidden={slot === front ? undefined : true}
                  className={
                    "velloo-frame-iframe absolute inset-0 border rounded-md bg-white" +
                    (slot === front ? "" : " invisible")
                  }
                  style={{
                    width: w,
                    height: h,
                    pointerEvents: slot === front && !passThrough ? "auto" : "none",
                  }}
                />
              ),
            )}
            {/*
              Resize handles. Faint dashed edge by default; firms up on
              hover but stays accent/40 rather than full accent so the
              frame's content isn't drowned out.
            */}
            <div
              onPointerDown={startResize("e")}
              className="absolute top-0 right-0 h-full w-0.5 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity border-r border-dashed border-primary/40 hover:border-solid hover:border-r-2 hover:border-primary/70"
              role="presentation"
            />
            <div
              onPointerDown={startResize("s")}
              className="absolute bottom-0 left-0 w-full h-0.5 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity border-b border-dashed border-primary/40 hover:border-solid hover:border-b-2 hover:border-primary/70"
              role="presentation"
            />
            <div
              onPointerDown={startResize("se")}
              className="absolute bottom-0 right-0 h-2 w-2 cursor-nwse-resize opacity-0 group-hover:opacity-100 transition-opacity bg-primary/50 hover:bg-primary rounded-br"
              role="presentation"
            />
          </div>
        )}

        <div
          style={{
            width: `calc(${w}px * var(--canvas-zoom, 1))`,
            transform: "scale(calc(1 / var(--canvas-zoom, 1)))",
            transformOrigin: "top left",
          }}
        >
          <FrameViewportPresets frame={frame} presets={presets} onPick={onPickPreset} />
        </div>
      </div>
      <AlertDialog
        open={confirmRemove}
        onOpenChange={(open) => {
          if (!open) setConfirmRemove(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove frame</AlertDialogTitle>
            <AlertDialogDescription>
              {`Remove this placement of "${frame.label ?? screen?.name ?? frame.screen}" from the board? The underlying screen stays — only this frame is removed. You can put it back with ⌘Z.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

/**
 * Add, update or drop one identified element in an iframe's `<head>`.
 *
 * Preview overrides are written into a document the canvas doesn't own and
 * re-applied after every buffer swap, so each one has to be idempotent and
 * removable by id rather than tracked in React state.
 */
function upsertHeadElement(
  doc: Document,
  id: string,
  tag: "style" | "link",
  wanted: string | null,
  configure: (el: HTMLElement) => void,
): void {
  const existing = doc.getElementById(id);
  if (wanted === null) {
    existing?.remove();
    return;
  }
  const el = existing ?? doc.createElement(tag);
  if (!existing) {
    el.id = id;
    doc.head.appendChild(el);
  }
  configure(el as HTMLElement);
}
