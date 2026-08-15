import type { Snippet, SnippetParam, ViewportPreset } from "@velloo/schema";
import { ArrowLeft, FileJson, Pencil, Save, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { postMutate } from "../api/http.ts";
import { fetchSnippet, type SnippetMeta } from "../api.ts";
import { useCanvas } from "../store.ts";
import { pushToast, toastError } from "../toast.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
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
 * `editingSnippetId` is set in the store. Renders the snippet in a
 * resizable preview frame at a chosen viewport with a sidecar for
 * name + params editing (which round-trips through `update_snippet`).
 *
 * Inline body editing isn't wired here yet — a `$snippet` instance is
 * opaque, so paths inside the body aren't addressable from the parent
 * iframe. The callout points users at MCP / hand-editing the body
 * until the body editor lands.
 */
export function SnippetView({ snippetId, snippetMeta, presets }: Props) {
  const closeSnippetEditor = useCanvas((s) => s.closeSnippetEditor);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const designMode = useCanvas((s) => s.designMode);
  const screenVersion = useCanvas((s) => s.screenVersion);
  const refreshDesignSummary = useCanvas((s) => s.refreshDesignSummary);

  const [snippet, setSnippet] = useState<Snippet | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // screenVersion is intentionally in the dep array: it bumps when
    // any screen/snippet rebroadcasts, which is the signal we use to
    // pull a fresh copy of the snippet body after an update_snippet
    // call (ours or someone else's via the watcher).
    void screenVersion;
    let alive = true;
    setLoading(true);
    fetchSnippet(snippetId)
      .then((s) => {
        if (alive) {
          setSnippet(s);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [snippetId, screenVersion]);

  const initialPreset =
    presets.find((p) => p.name.toLowerCase().includes("desktop")) ?? presets[0] ?? DEFAULT_VIEWPORT;
  const [viewport, setViewport] = useState<ViewportPreset>(initialPreset);

  const previewModeQs = designMode === "dark" ? "&mode=dark" : "";
  const previewUrl = `/api/render/snippet/${encodeURIComponent(snippetId)}?w=${viewport.w}&h=${viewport.h}&v=${themeVersion}.${screenVersion}${previewModeQs}`;
  void snippetMeta;

  const onPatch = async (patch: Partial<Pick<Snippet, "name" | "params">>) => {
    try {
      await postMutate("update_snippet", { snippetId, patch });
      // Watcher will rebroadcast; refresh the summary so the sidebar
      // labels follow renames without a manual reload.
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

  return (
    <div className="flex-1 flex min-h-0">
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        <Header
          snippet={snippet}
          presets={presets}
          viewport={viewport}
          setViewport={setViewport}
          onClose={closeSnippetEditor}
          onPatchName={(name) => onPatch({ name })}
        />
        <div className="flex-1 overflow-auto p-8">
          <div className="mx-auto flex flex-col items-center gap-4">
            <div
              className="rounded-md border bg-white shadow-sm overflow-hidden"
              style={{ width: viewport.w, height: viewport.h }}
            >
              <iframe
                title={`${snippet.name} preview`}
                src={previewUrl}
                className="block w-full h-full border-0"
                style={{ width: viewport.w, height: viewport.h }}
              />
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {viewport.w} × {viewport.h}
            </div>
          </div>
        </div>
      </div>
      <aside className="w-80 shrink-0 border-l bg-card flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            Snippet
          </div>
          <div className="mt-0.5 font-mono text-sm">@{snippet.id}</div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
          <ParamsPanel snippet={snippet} onPatchParams={(params) => onPatch({ params })} />
          <BodyEditHint snippetId={snippet.id} />
        </div>
      </aside>
    </div>
  );
}

interface HeaderProps {
  snippet: Snippet;
  presets: ViewportPreset[];
  viewport: ViewportPreset;
  setViewport: (p: ViewportPreset) => void;
  onClose: () => void;
  onPatchName: (name: string) => void;
}

function Header({ snippet, presets, viewport, setViewport, onClose, onPatchName }: HeaderProps) {
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
    <header className="border-b bg-card/40 backdrop-blur-sm px-6 py-3 flex items-center gap-3">
      <Button variant="ghost" size="sm" onClick={onClose} className="-ml-2">
        <ArrowLeft />
        Back
      </Button>
      <div className="flex-1 flex items-center gap-2 min-w-0">
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
            className="h-7 max-w-xs"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="font-semibold text-sm truncate inline-flex items-center gap-1.5 hover:text-primary group"
            title="Rename snippet"
          >
            {snippet.name}
            <Pencil
              size={12}
              strokeWidth={2}
              className="opacity-0 group-hover:opacity-50 transition-opacity"
            />
          </button>
        )}
        <Badge variant="outline" className="text-[10px] font-mono">
          snippet
        </Badge>
        <Sparkles
          size={12}
          strokeWidth={2}
          className="text-muted-foreground/60"
          aria-hidden="true"
        />
      </div>
      <Select
        value={viewport.name}
        onValueChange={(name) => {
          const next = presets.find((p) => p.name === name);
          if (next) setViewport(next);
        }}
      >
        <SelectTrigger size="sm" className="text-xs w-32">
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
}

function ParamsPanel({ snippet, onPatchParams }: ParamsPanelProps) {
  const [editingParam, setEditingParam] = useState<number | null>(null);
  const [draft, setDraft] = useState<SnippetParam | null>(null);

  const openEdit = (index: number) => {
    setEditingParam(index);
    setDraft({ ...(snippet.params[index] as SnippetParam) });
  };

  const commit = () => {
    if (editingParam === null || draft === null) return;
    const next = [...snippet.params];
    next[editingParam] = draft;
    setEditingParam(null);
    setDraft(null);
    onPatchParams(next);
  };

  const remove = (index: number) => {
    if (
      !confirm(
        `Remove parameter "${snippet.params[index]?.name}"? Existing instances will lose this arg.`,
      )
    )
      return;
    const next = snippet.params.filter((_, i) => i !== index);
    onPatchParams(next);
  };

  const addParam = () => {
    const existing = new Set(snippet.params.map((p) => p.name));
    let name = "param";
    let i = 1;
    while (existing.has(name)) name = `param${++i}`;
    const next: SnippetParam[] = [...snippet.params, { name, type: "string" }];
    onPatchParams(next);
    pushToast({ kind: "success", message: `Added param "${name}"` });
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Parameters
        </div>
        <Button variant="ghost" size="xs" onClick={addParam} className="h-6 text-xs">
          + add
        </Button>
      </div>
      {snippet.params.length === 0 ? (
        <div className="text-xs text-muted-foreground rounded-md border border-dashed p-3 leading-relaxed">
          No parameters yet. Params are typed inputs an instance passes in via{" "}
          <code className="text-[10px] font-mono px-1 py-0.5 rounded bg-muted">args</code>; the body
          can reference them as{" "}
          <code className="text-[10px] font-mono px-1 py-0.5 rounded bg-muted">
            {"{ $param: name }"}
          </code>
          .
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {snippet.params.map((p, i) => (
            <li key={p.name} className="rounded-md border bg-background">
              {editingParam === i && draft ? (
                <ParamEditor
                  param={draft}
                  onChange={setDraft}
                  onSave={commit}
                  onCancel={() => {
                    setEditingParam(null);
                    setDraft(null);
                  }}
                />
              ) : (
                <ParamRow param={p} onEdit={() => openEdit(i)} onRemove={() => remove(i)} />
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
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5">
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="font-mono text-xs truncate">{param.name}</span>
        <Badge variant="outline" className="text-[10px] font-mono">
          {param.type}
        </Badge>
        {param.default !== undefined ? (
          <span className="text-[10px] text-muted-foreground font-mono truncate">
            = {JSON.stringify(param.default)}
          </span>
        ) : null}
      </div>
      <Button variant="ghost" size="xs" onClick={onEdit} className="h-6 px-1.5">
        <Pencil size={11} />
      </Button>
      <Button
        variant="ghost"
        size="xs"
        onClick={onRemove}
        className="h-6 px-1.5 text-destructive hover:bg-destructive/10"
      >
        <X size={11} />
      </Button>
    </div>
  );
}

function ParamEditor({
  param,
  onChange,
  onSave,
  onCancel,
}: {
  param: SnippetParam;
  onChange: (p: SnippetParam) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const types: SnippetParam["type"][] = [
    "string",
    "number",
    "boolean",
    "node",
    "icon",
    "color",
    "enum",
  ];
  const enumDraft = useMemo(
    () => (Array.isArray(param.enum) ? param.enum.join(", ") : ""),
    [param.enum],
  );

  return (
    <div className="p-2.5 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-[10px]">name</Label>
          <Input
            value={param.name}
            onChange={(e) => onChange({ ...param, name: e.target.value })}
            className="h-7 font-mono text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[10px]">type</Label>
          <Select
            value={param.type}
            onValueChange={(v) => onChange({ ...param, type: v as SnippetParam["type"] })}
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
      <div className="flex flex-col gap-1">
        <Label className="text-[10px]">default (JSON)</Label>
        <Input
          value={param.default === undefined ? "" : JSON.stringify(param.default)}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw.trim() === "") {
              const { default: _omit, ...rest } = param;
              void _omit;
              onChange(rest);
              return;
            }
            try {
              const parsed = JSON.parse(raw);
              onChange({ ...param, default: parsed });
            } catch {
              // Leave the previous default in place if the JSON is malformed;
              // the user will see their text persist while they fix it.
            }
          }}
          className="h-7 font-mono text-xs"
          placeholder={'"" or 0 or true'}
        />
      </div>
      {param.type === "enum" ? (
        <div className="flex flex-col gap-1">
          <Label className="text-[10px]">enum (comma-separated)</Label>
          <Input
            defaultValue={enumDraft}
            onBlur={(e) => {
              const values = e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              onChange({ ...param, enum: values.length > 0 ? values : undefined });
            }}
            className="h-7 font-mono text-xs"
            placeholder="solid, ghost, outline"
          />
        </div>
      ) : null}
      <div className="flex gap-1.5 justify-end">
        <Button variant="ghost" size="xs" onClick={onCancel} className="h-6 text-xs">
          Cancel
        </Button>
        <Button size="xs" onClick={onSave} className="h-6 text-xs">
          <Save size={11} /> Save
        </Button>
      </div>
    </div>
  );
}

function BodyEditHint({ snippetId }: { snippetId: string }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
        Edit the body
      </div>
      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground leading-relaxed flex flex-col gap-2">
        <p>
          The snippet body lives in{" "}
          <code className="text-[10px] font-mono px-1 py-0.5 rounded bg-background border">
            snippets/{snippetId}.json
          </code>
          . Today the canvas inspector targets screens, not snippet bodies — so edits land via your
          AI agent or the file directly.
        </p>
        <p className="flex items-center gap-1.5">
          <FileJson size={12} strokeWidth={2} aria-hidden="true" />
          From your agent:{" "}
          <code className="text-[10px] font-mono px-1 py-0.5 rounded bg-background border">
            update_snippet
          </code>
          ,{" "}
          <code className="text-[10px] font-mono px-1 py-0.5 rounded bg-background border">
            add_node
          </code>{" "}
          (with a synthesized parent path), or hand-edit + save.
        </p>
        <p>
          Either path triggers the watcher, this preview hot-updates, and every instance follows
          live.
        </p>
      </div>
    </section>
  );
}
