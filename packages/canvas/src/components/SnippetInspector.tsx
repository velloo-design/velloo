import type { Snippet, SnippetInstance, SnippetParam } from "@velloo/schema";
import { useEffect, useRef, useState } from "react";
import { fetchSnippet, mutate, type SnippetMeta } from "../api.ts";
import { pathFromString } from "../path.ts";
import { type Selection, useCanvas } from "../store.ts";

const DEBOUNCE_MS = 200;

interface Props {
  pageId: string;
  selection: Selection;
  node: SnippetInstance;
}

/**
 * Inspector for a `$snippet` instance. Shows the snippet's declared params
 * as editable fields and patches the instance's `args` map. Editing the
 * snippet body itself happens elsewhere — the file system or a future
 * "open snippet" canvas mode.
 */
export function SnippetInspector({ pageId, selection, node }: Props) {
  const design = useCanvas((s) => s.design);
  const snippetMeta: SnippetMeta | undefined = design?.snippets.find((s) => s.id === node.$snippet);

  // Load full snippet body lazily if we ever want it; for now we only need params,
  // and design already carries them.
  const [snippet, setSnippet] = useState<Snippet | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchSnippet(node.$snippet)
      .then((s) => {
        if (alive) setSnippet(s);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [node.$snippet]);

  const params = snippet?.params ?? snippetMeta?.params ?? [];
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitArg = (name: string, value: unknown) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void mutate
        .updateSnippetArgs({
          pageId,
          variantId: selection.variantId,
          path: pathFromString(selection.path),
          argPatch: { [name]: value === undefined ? null : value },
        })
        .catch(() => undefined);
    }, DEBOUNCE_MS);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-4 py-3 border-b border-[var(--color-border)]">
        <div className="font-semibold text-sm truncate">@{node.$snippet}</div>
        <div className="text-xs text-[var(--color-fg-muted)] mt-0.5">
          {selection.variantId} · {selection.path === "" ? "(root)" : selection.path} · snippet
          instance
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {snippetMeta == null ? (
          <div className="text-xs text-[var(--color-fg-muted)]">
            Snippet "{node.$snippet}" is not in the registry — the instance is dangling.
          </div>
        ) : params.length === 0 ? (
          <div className="text-xs text-[var(--color-fg-muted)]">This snippet takes no params.</div>
        ) : (
          <section className="flex flex-col gap-3">
            <div className="text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
              Args
            </div>
            {params.map((p) => (
              <ArgField
                key={`${selection.variantId}:${selection.path}:${p.name}`}
                param={p}
                initialValue={node.args?.[p.name]}
                onChange={(v) => commitArg(p.name, v)}
              />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

interface ArgFieldProps {
  param: SnippetParam;
  initialValue: unknown;
  onChange: (v: unknown) => void;
}

function ArgField({ param, initialValue, onChange }: ArgFieldProps) {
  const [value, setValue] = useState<string>(() => {
    if (initialValue === undefined || initialValue === null) return "";
    if (typeof initialValue === "string") return initialValue;
    return JSON.stringify(initialValue);
  });

  if (param.type === "boolean") {
    const checked = initialValue === true;
    return (
      <label className="flex items-center justify-between gap-3 text-xs">
        <span className="text-[var(--color-fg)]">{param.name}</span>
        <input
          type="checkbox"
          defaultChecked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
      </label>
    );
  }

  if (param.type === "number") {
    return (
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-[var(--color-fg)]">{param.name}</span>
        <input
          type="number"
          className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
      </label>
    );
  }

  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-[var(--color-fg)]">{param.name}</span>
      <input
        type="text"
        className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onChange(e.target.value);
        }}
      />
    </label>
  );
}
