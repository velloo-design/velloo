import type { Screen, Snippet, ViewportPreset } from "@velloo/schema";
import { ArrowLeft, Pencil, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { postMutate } from "../api/http.ts";
import { fetchSnippet, type SnippetMeta } from "../api.ts";
import { IframeChannel } from "../iframe-channel.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { Inspector } from "./Inspector.tsx";
import { SnippetParamsPanel } from "./SnippetParamsPanel.tsx";
import { Tree } from "./Tree.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";

interface Props {
  snippetId: string;
  snippetMeta: SnippetMeta | null;
  presets: ViewportPreset[];
}

const DEFAULT_VIEWPORT: ViewportPreset = { name: "Snippet", w: 480, h: 360 };

/**
 * Focused view of a single snippet. Replaces the board canvas while
 * `editingSnippetId` is set in the store.
 *
 * Layout mirrors the boards mode so the inspector + tree feel familiar:
 *  - Left rail: Tree of the snippet body, plus snippet-level controls
 *    (rename, params).
 *  - Center: a single iframe rendering the body (via the
 *    `/api/render/snippet-body/:id` route which surfaces internal paths
 *    for click-selection) plus a "Back to boards" header.
 *  - Right rail: the standard Inspector. When the user clicks into the
 *    iframe, selection is set with `screenId = "snippet:<id>"` and the
 *    server's mutation layer routes the resulting `update_props` /
 *    `apply_classes` calls back to the snippet body via the virtualized
 *    screen path (see `mutations/lookup.ts#SNIPPET_TREE_PREFIX`).
 */
export function SnippetView({ snippetId, snippetMeta, presets }: Props) {
  const closeSnippetEditor = useCanvas((s) => s.closeSnippetEditor);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const designMode = useCanvas((s) => s.designMode);
  const screenRev = useCanvas((s) => s.screenVersions[`snippet:${snippetId}`] ?? 0);
  const refreshDesignSummary = useCanvas((s) => s.refreshDesignSummary);
  const setSelection = useCanvas((s) => s.setSelection);
  const setHover = useCanvas((s) => s.setHover);
  const setNodeRects = useCanvas((s) => s.setNodeRects);
  const clearNodeRects = useCanvas((s) => s.clearNodeRects);
  const selection = useCanvas((s) => s.selection);
  const nodeState = useCanvas((s) => s.nodeState);
  const setScreen = useCanvas((s) => s.setSyntheticScreen);
  const loadComponents = useCanvas((s) => s.loadComponents);

  const virtualScreenId = `snippet:${snippetId}`;
  const syntheticScreen: Screen | null = useCanvas((s) => s.screens[virtualScreenId] ?? null);

  // The params panel needs the manifest (icon names); load it up front.
  useEffect(() => {
    void loadComponents();
  }, [loadComponents]);

  const [snippet, setSnippet] = useState<Snippet | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // One-shot fetch on mount + snippetId change. The WS handler in
    // `ws-client.ts` re-pulls the snippet (and re-installs the
    // synthetic screen) on every `snippet-changed` broadcast, so we
    // don't need to depend on `screenVersion` here — and listing it
    // would create a re-fetch loop: `setSyntheticScreen` bumps the
    // version, the effect re-fires, refetches, bumps again, and the
    // user sees "Loading snippet…" forever.
    let alive = true;
    setLoading(true);
    fetchSnippet(snippetId)
      .then((s) => {
        if (!alive) return;
        setSnippet(s);
        setLoading(false);
        // Install the body as a synthetic screen keyed by the
        // `snippet:` prefix. Selection / Tree / Inspector are all
        // screen-shaped — letting them target this id lets us reuse
        // them unchanged.
        // Carry the snippet's library so the Inspector edits the body in that
        // library's native style channel (sx for a MUI snippet, not className).
        setScreen(virtualScreenId, {
          id: virtualScreenId,
          name: s.name,
          tree: s.tree,
          ...(s.library ? { library: s.library } : {}),
        });
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [snippetId, setScreen, virtualScreenId]);

  const initialPreset =
    presets.find((p) => p.name.toLowerCase().includes("desktop")) ?? presets[0] ?? DEFAULT_VIEWPORT;
  const [viewport, setViewport] = useState<ViewportPreset>(initialPreset);

  const previewModeQs = designMode === "dark" ? "&mode=dark" : "";
  const previewUrl = `/api/render/snippet-body/${encodeURIComponent(snippetId)}?w=${viewport.w}&h=${viewport.h}&v=${themeVersion}.${screenRev}${previewModeQs}`;

  // Per-iframe channel so clicks in the snippet preview report paths
  // into the body (not collapsed to the snippet-instance root, which
  // is what the `/api/render/snippet/:id` route does).
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const scrollWrapRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<IframeChannel | null>(null);
  const frameId = `snippet-view-${snippetId}`;

  useEffect(() => {
    void loading; // re-run once loading flips so the now-mounted iframe attaches
    const iframe = iframeRef.current;
    if (!iframe) return;
    const channel = new IframeChannel(iframe, {
      onSelect(path) {
        if (path === null) setSelection(null);
        else setSelection({ screenId: virtualScreenId, path });
      },
      onHover(path) {
        if (path === null) setHover(null);
        else setHover({ screenId: virtualScreenId, path });
      },
      onRects(rects) {
        setNodeRects(frameId, rects);
      },
      // Wheel forwarded from the iframe — when the cursor sits over
      // the preview, scroll the outer container. Without this the
      // iframe absorbs the trackpad pan and a wide viewport feels
      // stuck.
      onParentPan(deltaX, deltaY) {
        const el = scrollWrapRef.current;
        if (!el) return;
        el.scrollLeft += deltaX;
        el.scrollTop += deltaY;
      },
    });
    channelRef.current = channel;
    const onLoad = () => channel.attach();
    iframe.addEventListener("load", onLoad);
    if (iframe.contentDocument?.readyState === "complete") channel.attach();
    return () => {
      iframe.removeEventListener("load", onLoad);
      channel.destroy();
      channelRef.current = null;
      clearNodeRects(frameId);
    };
    // `loading`: the iframe isn't mounted while the "Loading snippet…"
    // placeholder is showing, so the first run finds a null ref; re-run once
    // loading flips so the channel attaches (else select/hover/pan are dead).
  }, [loading, virtualScreenId, frameId, setSelection, setHover, setNodeRects, clearNodeRects]);

  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    if (selection?.screenId === virtualScreenId) {
      channel.send({ type: "applyHighlight", path: selection.path });
    } else {
      channel.send({ type: "clearHighlight" });
    }
  }, [selection, virtualScreenId]);

  // Force-state preview (mirrors Frame): drive the body iframe's pinned
  // pseudo-state from the Inspector's State dropdown for the selected node.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    const path = selection?.screenId === virtualScreenId ? selection.path : null;
    channel.send({ type: "applyVelloState", path, state: path ? nodeState : "default" });
  }, [nodeState, selection, virtualScreenId]);

  const onPatchMeta = async (patch: Partial<Pick<Snippet, "name" | "params">>) => {
    try {
      await postMutate("update_snippet", { snippetId, patch });
      void refreshDesignSummary();
    } catch (err) {
      toastError(err, "Could not update snippet");
    }
  };

  if (loading) {
    return (
      <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
        Loading snippet…
      </div>
    );
  }

  if (!snippet) {
    return (
      <div className="flex-1 grid place-items-center text-sm text-muted-foreground gap-2">
        <div>Snippet "{snippetId}" not found.</div>
        <Button variant="ghost" size="sm" onClick={closeSnippetEditor}>
          <ArrowLeft /> Back
        </Button>
      </div>
    );
  }

  const showInspector = selection?.screenId === virtualScreenId;

  // The local `snippet` is a one-shot fetch; `snippetMeta` (from the design
  // summary) is refreshed on every `snippet-changed`, so overlay its name/params
  // for the header + params panel — otherwise a rename/param-add only shows
  // after close+reopen. The body/tree stay on the synthetic screen (also fresh).
  const displaySnippet: Snippet = {
    ...snippet,
    name: snippetMeta?.name ?? snippet.name,
    params: snippetMeta?.params ?? snippet.params,
  };

  return (
    <div className="flex-1 flex min-h-0">
      <aside className="flex h-full w-72 shrink-0 flex-col border-r bg-card">
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          <Button variant="ghost" size="xs" onClick={closeSnippetEditor} className="-ml-1">
            <ArrowLeft size={12} />
            Back
          </Button>
          <Badge variant="outline" className="ml-auto text-[10px] font-mono">
            snippet
          </Badge>
        </div>
        <SnippetHeader snippet={displaySnippet} onPatchName={(name) => onPatchMeta({ name })} />
        <SnippetParamsPanel
          snippet={displaySnippet}
          onPatchParams={(params) => onPatchMeta({ params })}
        />
        <div className="border-t flex-1 overflow-y-auto">
          <SectionLabel>Body</SectionLabel>
          {syntheticScreen ? (
            <Tree key={syntheticScreen.id} screen={syntheticScreen} />
          ) : (
            <div className="px-4 py-3 text-xs text-muted-foreground">No body to display.</div>
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-background">
        <PreviewToolbar
          presets={presets}
          viewport={viewport}
          setViewport={setViewport}
          snippet={displaySnippet}
        />
        <div ref={scrollWrapRef} className="flex-1 overflow-auto bg-muted/30">
          <div className="min-w-fit min-h-full flex items-center justify-center p-8">
            <div className="flex flex-col items-center gap-3">
              <div
                className="rounded-md border bg-white shadow-sm overflow-hidden shrink-0"
                style={{ width: viewport.w, height: viewport.h }}
              >
                <iframe
                  ref={iframeRef}
                  title={`${snippet.name} preview`}
                  src={previewUrl}
                  className="block border-0"
                  style={{ width: viewport.w, height: viewport.h }}
                />
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {viewport.w} × {viewport.h}
              </div>
            </div>
          </div>
        </div>
      </main>

      <aside className="w-80 shrink-0 border-l bg-card flex flex-col overflow-hidden">
        {showInspector ? (
          <Inspector />
        ) : (
          <div className="flex-1 grid place-items-center text-xs text-muted-foreground p-6 text-center leading-relaxed">
            Click a node in the snippet preview to edit its props, classes, or stable id. Param
            slots render as <span className="font-mono">$name</span> badges — open the param's
            instances elsewhere to see how each is filled.
          </div>
        )}
      </aside>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
      {children}
    </div>
  );
}

function SnippetHeader({
  snippet,
  onPatchName,
}: {
  snippet: Snippet;
  onPatchName: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(snippet.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(snippet.name);
  }, [snippet.name]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== snippet.name) onPatchName(trimmed);
    else setDraft(snippet.name);
  };

  return (
    <div className="px-3 py-2 border-b">
      {editing ? (
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setEditing(false);
              setDraft(snippet.name);
            }
          }}
          className="h-7"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="w-full text-left font-semibold text-sm flex items-center gap-1.5 hover:text-primary group truncate"
          title="Rename snippet"
        >
          <Sparkles size={11} className="text-muted-foreground shrink-0" aria-hidden="true" />
          <span className="truncate">{snippet.name}</span>
          <Pencil
            size={10}
            className="opacity-0 group-hover:opacity-50 transition-opacity shrink-0"
          />
        </button>
      )}
      <div className="mt-0.5 text-[10px] font-mono text-muted-foreground truncate">
        @{snippet.id}
      </div>
    </div>
  );
}

interface PreviewToolbarProps {
  snippet: Snippet;
  presets: ViewportPreset[];
  viewport: ViewportPreset;
  setViewport: (p: ViewportPreset) => void;
}

function PreviewToolbar({ snippet, presets, viewport, setViewport }: PreviewToolbarProps) {
  return (
    <header className="border-b bg-card/40 backdrop-blur-sm px-6 py-2.5 flex items-center gap-3">
      <div className="text-xs text-muted-foreground">
        Preview · <span className="font-medium text-foreground">{snippet.name}</span>
      </div>
      <div className="flex-1" />
      <Select
        value={viewport.name}
        onValueChange={(name) => {
          const next = presets.find((p) => p.name === name);
          if (next) setViewport(next);
        }}
      >
        <SelectTrigger size="sm" className="text-xs w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {presets.map((p) => (
            <SelectItem key={p.name} value={p.name}>
              {p.name} · {p.w}×{p.h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </header>
  );
}
