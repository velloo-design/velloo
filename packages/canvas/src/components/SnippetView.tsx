import type { Screen, Snippet, SnippetParam, ViewportPreset } from "@velloo/schema";
import { ArrowLeft, Pencil, Save, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { postMutate } from "../api/http.ts";
import { fetchSnippet, type SnippetMeta } from "../api.ts";
import { IframeChannel } from "../iframe-channel.ts";
import { useCanvas } from "../store.ts";
import { pushToast, toastError } from "../toast.ts";
import { IconPicker } from "./IconPicker.tsx";
import { Inspector } from "./Inspector.tsx";
import { Tree } from "./Tree.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Checkbox } from "./ui/checkbox.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";
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
  const screenVersion = useCanvas((s) => s.screenVersion);
  const refreshDesignSummary = useCanvas((s) => s.refreshDesignSummary);
  const setSelection = useCanvas((s) => s.setSelection);
  const setHover = useCanvas((s) => s.setHover);
  const setNodeRects = useCanvas((s) => s.setNodeRects);
  const clearNodeRects = useCanvas((s) => s.clearNodeRects);
  const selection = useCanvas((s) => s.selection);
  const setScreen = useCanvas((s) => s.setSyntheticScreen);
  const components = useCanvas((s) => s.components);
  const loadComponents = useCanvas((s) => s.loadComponents);

  void snippetMeta;
  const virtualScreenId = `snippet:${snippetId}`;
  const syntheticScreen: Screen | null = useCanvas((s) => s.screens[virtualScreenId] ?? null);

  useEffect(() => {
    void loadComponents();
  }, [loadComponents]);

  const iconNames: string[] =
    (components?.find((c) => c.id === "Icon")?.props.find((p) => p.name === "name")?.enumValues as
      | string[]
      | undefined) ?? [];

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
  const previewUrl = `/api/render/snippet-body/${encodeURIComponent(snippetId)}?w=${viewport.w}&h=${viewport.h}&v=${themeVersion}.${screenVersion}${previewModeQs}`;

  // Per-iframe channel so clicks in the snippet preview report paths
  // into the body (not collapsed to the snippet-instance root, which
  // is what the `/api/render/snippet/:id` route does).
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const scrollWrapRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<IframeChannel | null>(null);
  const frameId = `snippet-view-${snippetId}`;

  useEffect(() => {
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
  }, [virtualScreenId, frameId, setSelection, setHover, setNodeRects, clearNodeRects]);

  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    if (selection?.screenId === virtualScreenId) {
      channel.send({ type: "applyHighlight", path: selection.path });
    } else {
      channel.send({ type: "clearHighlight" });
    }
  }, [selection, virtualScreenId]);

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
        <SnippetHeader snippet={snippet} onPatchName={(name) => onPatchMeta({ name })} />
        <ParamsPanel
          snippet={snippet}
          onPatchParams={(params) => onPatchMeta({ params })}
          iconNames={iconNames}
        />
        <div className="border-t flex-1 overflow-y-auto">
          <SectionLabel>Body</SectionLabel>
          {syntheticScreen ? (
            <Tree screen={syntheticScreen} />
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
          snippet={snippet}
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

interface ParamsPanelProps {
  snippet: Snippet;
  onPatchParams: (params: SnippetParam[]) => void;
  iconNames: string[];
}

function ParamsPanel({ snippet, onPatchParams, iconNames }: ParamsPanelProps) {
  const [editingParam, setEditingParam] = useState<number | null>(null);

  const updateParam = (index: number, next: SnippetParam) => {
    const list = [...snippet.params];
    list[index] = next;
    onPatchParams(list);
  };

  const remove = (index: number) => {
    if (
      !confirm(
        `Remove parameter "${snippet.params[index]?.name}"? Existing instances will lose this arg.`,
      )
    )
      return;
    onPatchParams(snippet.params.filter((_, i) => i !== index));
  };

  const addParam = () => {
    const existing = new Set(snippet.params.map((p) => p.name));
    let name = "param";
    let i = 1;
    while (existing.has(name)) name = `param${++i}`;
    onPatchParams([...snippet.params, { name, type: "string" }]);
    pushToast({ kind: "success", message: `Added param "${name}"` });
  };

  return (
    <section className="border-b flex flex-col gap-1 px-3 pt-3 pb-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Params
        </div>
        <Button variant="ghost" size="xs" onClick={addParam} className="h-6 text-xs px-1.5">
          + add
        </Button>
      </div>
      {snippet.params.length === 0 ? (
        <div className="text-[11px] text-muted-foreground leading-relaxed mt-1">
          No params yet. Add one above, then reference it in the body as{" "}
          <code className="text-[10px] font-mono px-1 py-0.5 rounded bg-muted">
            {"{$param:name}"}
          </code>
          .
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {snippet.params.map((p, i) => (
            <li key={p.name} className="rounded-md border bg-background">
              {editingParam === i ? (
                <ParamEditor
                  initial={p}
                  iconNames={iconNames}
                  onSave={(next) => {
                    setEditingParam(null);
                    updateParam(i, next);
                  }}
                  onCancel={() => setEditingParam(null)}
                />
              ) : (
                <ParamRow param={p} onEdit={() => setEditingParam(i)} onRemove={() => remove(i)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ParamRow({
  param,
  onEdit,
  onRemove,
}: {
  param: SnippetParam;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const summary = formatDefaultSummary(param);
  return (
    <div className="flex items-center gap-1.5 px-2 py-1">
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="font-mono text-[11px] truncate">{param.name}</span>
        <Badge variant="outline" className="text-[9px] font-mono shrink-0">
          {param.type}
        </Badge>
        {summary ? (
          <span className="text-[10px] text-muted-foreground truncate">{summary}</span>
        ) : (
          <span className="text-[10px] text-amber-600 dark:text-amber-400">required</span>
        )}
      </div>
      <Button variant="ghost" size="xs" onClick={onEdit} className="h-5 px-1">
        <Pencil size={10} />
      </Button>
      <Button
        variant="ghost"
        size="xs"
        onClick={onRemove}
        className="h-5 px-1 text-destructive hover:bg-destructive/10"
      >
        <X size={10} />
      </Button>
    </div>
  );
}

function formatDefaultSummary(param: SnippetParam): string | null {
  if (param.default === undefined) return null;
  if (typeof param.default === "string") return `= "${param.default}"`;
  if (typeof param.default === "number" || typeof param.default === "boolean")
    return `= ${param.default}`;
  return "= …";
}

function ParamEditor({
  initial,
  iconNames,
  onSave,
  onCancel,
}: {
  initial: SnippetParam;
  iconNames: string[];
  onSave: (next: SnippetParam) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<SnippetParam>(initial);
  const required = draft.default === undefined;
  const types: SnippetParam["type"][] = [
    "string",
    "number",
    "boolean",
    "node",
    "icon",
    "color",
    "enum",
  ];

  const setRequired = (req: boolean) => {
    if (req) {
      const { default: _omit, ...rest } = draft;
      void _omit;
      setDraft(rest);
    } else {
      // Re-add a default appropriate for the type.
      setDraft({ ...draft, default: defaultValueForType(draft.type, draft.enum) });
    }
  };

  return (
    <div className="p-2 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex flex-col gap-1">
          <Label className="text-[10px]">name</Label>
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="h-7 font-mono text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[10px]">type</Label>
          <Select
            value={draft.type}
            onValueChange={(v) => {
              const nextType = v as SnippetParam["type"];
              // Reset default to a sensible value for the new type so
              // the user doesn't end up with e.g. number default after
              // switching to "icon".
              const next: SnippetParam = { ...draft, type: nextType };
              if (next.default !== undefined) {
                next.default = defaultValueForType(nextType, next.enum);
              }
              setDraft(next);
            }}
          >
            <SelectTrigger size="sm" className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {draft.type === "enum" ? (
        <EnumValuesField
          value={draft.enum ?? []}
          onChange={(enumValues) => setDraft({ ...draft, enum: enumValues })}
        />
      ) : null}

      <div className="flex items-center gap-2">
        <Checkbox
          id="param-required"
          checked={required}
          onCheckedChange={(c) => setRequired(Boolean(c))}
        />
        <Label htmlFor="param-required" className="text-[11px]">
          Required (no default — instances must supply a value)
        </Label>
      </div>

      {!required ? (
        <DefaultField
          param={draft}
          iconNames={iconNames}
          onChange={(value) => setDraft({ ...draft, default: value })}
        />
      ) : null}

      <div className="flex gap-1.5 justify-end">
        <Button variant="ghost" size="xs" onClick={onCancel} className="h-6 text-xs">
          Cancel
        </Button>
        <Button size="xs" onClick={() => onSave(draft)} className="h-6 text-xs">
          <Save size={11} /> Save
        </Button>
      </div>
    </div>
  );
}

function defaultValueForType(type: SnippetParam["type"], enumValues?: string[]): unknown {
  switch (type) {
    case "string":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "icon":
      return "Sparkles";
    case "color":
      return "#7c3aed";
    case "enum":
      return enumValues?.[0] ?? "";
    case "node":
      return { $ref: "Text", props: { children: "node default" } };
    default:
      return null;
  }
}

function DefaultField({
  param,
  iconNames,
  onChange,
}: {
  param: SnippetParam;
  iconNames: string[];
  onChange: (value: unknown) => void;
}) {
  const id = `param-default-${param.name}`;
  switch (param.type) {
    case "string":
      return (
        <div className="flex flex-col gap-1">
          <Label htmlFor={id} className="text-[10px]">
            default
          </Label>
          <Input
            id={id}
            value={typeof param.default === "string" ? param.default : ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder="default text"
            className="h-7 text-xs"
          />
        </div>
      );
    case "number":
      return (
        <div className="flex flex-col gap-1">
          <Label htmlFor={id} className="text-[10px]">
            default
          </Label>
          <Input
            id={id}
            type="number"
            value={typeof param.default === "number" ? param.default : 0}
            onChange={(e) => {
              const n = Number(e.target.value);
              onChange(Number.isFinite(n) ? n : 0);
            }}
            className="h-7 text-xs"
          />
        </div>
      );
    case "boolean":
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={Boolean(param.default)}
            onCheckedChange={(c) => onChange(Boolean(c))}
          />
          <Label htmlFor={id} className="text-[11px]">
            default {param.default ? "true" : "false"}
          </Label>
        </div>
      );
    case "icon": {
      const current = typeof param.default === "string" ? param.default : "Sparkles";
      return (
        <div className="flex flex-col gap-1">
          <Label className="text-[10px]">default icon</Label>
          <IconPicker value={current} options={iconNames} onChange={(name) => onChange(name)} />
        </div>
      );
    }
    case "color": {
      const current = typeof param.default === "string" ? param.default : "#7c3aed";
      return (
        <div className="flex flex-col gap-1">
          <Label className="text-[10px]">default color</Label>
          <div className="flex gap-1.5">
            <input
              type="color"
              aria-label="default color"
              value={current.startsWith("#") ? current : "#7c3aed"}
              onChange={(e) => onChange(e.target.value)}
              className="h-7 w-9 rounded border border-input bg-transparent"
            />
            <Input
              value={current}
              onChange={(e) => onChange(e.target.value)}
              className="flex-1 h-7 font-mono text-xs"
            />
          </div>
        </div>
      );
    }
    case "enum": {
      const current = typeof param.default === "string" ? param.default : "";
      return (
        <div className="flex flex-col gap-1">
          <Label className="text-[10px]">default</Label>
          <Select value={current || undefined} onValueChange={(v) => onChange(v)}>
            <SelectTrigger size="sm" className="text-xs">
              <SelectValue placeholder="(pick one)" />
            </SelectTrigger>
            <SelectContent>
              {(param.enum ?? []).map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }
    case "node":
      return (
        <div className="flex flex-col gap-1">
          <Label className="text-[10px]">default (JSON node)</Label>
          <Input
            value={JSON.stringify(param.default ?? null)}
            onChange={(e) => {
              try {
                onChange(JSON.parse(e.target.value));
              } catch {
                // Keep the previous default if the JSON is malformed —
                // the user is mid-edit. We don't show a control here
                // because the input is uncontrolled-by-content.
              }
            }}
            className="h-7 font-mono text-[10px]"
            placeholder='{"$ref":"Text","props":{"children":"..."}}'
          />
        </div>
      );
    default:
      return null;
  }
}

function EnumValuesField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState(value.join(", "));
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px]">enum (comma-separated)</Label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const parsed = draft
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          onChange(parsed);
        }}
        className="h-7 font-mono text-xs"
        placeholder="solid, ghost, outline"
      />
    </div>
  );
}
