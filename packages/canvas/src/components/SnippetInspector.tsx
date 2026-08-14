import type { Snippet, SnippetInstance, SnippetParam } from "@velloo/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSnippet, mutate, type SnippetMeta } from "../api.ts";
import { pathFromString } from "../path.ts";
import { type Selection, useCanvas } from "../store.ts";
import { IconPicker } from "./IconPicker.tsx";

const DEBOUNCE_MS = 200;

interface Props {
  selection: Selection;
  node: SnippetInstance;
}

/**
 * Inspector for a `$snippet` instance. Shows the snippet's declared params
 * as editable fields and patches the instance's `args` map. Editing the
 * snippet body itself happens elsewhere — the file system or a future
 * "open snippet" canvas mode.
 */
export function SnippetInspector({ selection, node }: Props) {
  const design = useCanvas((s) => s.design);
  const components = useCanvas((s) => s.components);
  const snippetMeta: SnippetMeta | undefined = design?.snippets.find((s) => s.id === node.$snippet);

  // Lucide icon names come from the Icon component's manifest entry —
  // the snapshot ships an `enumValues` list of every name the build
  // saw. Feed that into the icon picker so `type: "icon"` params get
  // a typeahead grid like the regular node inspector.
  const lucideIconNames = useMemo<string[]>(() => {
    const icon = components?.find((c) => c.id === "Icon");
    const name = icon?.props.find((p) => p.name === "name");
    return Array.isArray(name?.enumValues) ? (name.enumValues as string[]) : [];
  }, [components]);

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
          screenId: selection.screenId,
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
          {selection.screenId} · {selection.path === "" ? "(root)" : selection.path} · snippet
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
                key={`${selection.screenId}:${selection.path}:${p.name}`}
                param={p}
                initialValue={node.args?.[p.name]}
                onChange={(v) => commitArg(p.name, v)}
                lucideIconNames={lucideIconNames}
              />
            ))}
          </section>
        )}
        <SnippetInstances snippetId={node.$snippet} selection={selection} />
      </div>
    </div>
  );
}

interface InstanceLocation {
  screenId: string;
  path: string;
  hasOverride: boolean;
}

/**
 * Sibling-instances widget: show every other place this snippet is
 * used, so the designer knows the blast radius before they edit it.
 * Click an entry to jump to it.
 */
function SnippetInstances({ snippetId, selection }: { snippetId: string; selection: Selection }) {
  const [locs, setLocs] = useState<InstanceLocation[] | null>(null);
  const screenVersion = useCanvas((s) => s.screenVersion);
  const selectScreen = useCanvas((s) => s.selectScreen);
  const setSelection = useCanvas((s) => s.setSelection);

  useEffect(() => {
    // screenVersion isn't read here, but bumping it is the cue to
    // refetch — every screen edit can change instance counts.
    void screenVersion;
    let alive = true;
    void fetch(`/api/snippets/${encodeURIComponent(snippetId)}/instances`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((body: { instances: InstanceLocation[] }) => {
        if (alive) setLocs(body.instances);
      })
      .catch(() => {
        if (alive) setLocs([]);
      });
    return () => {
      alive = false;
    };
  }, [snippetId, screenVersion]);

  if (!locs) return null;
  const overrideCount = locs.filter((l) => l.hasOverride).length;
  const isCurrent = (l: InstanceLocation) =>
    l.screenId === selection.screenId && l.path === selection.path;

  return (
    <section className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
          Instances
        </div>
        <div className="text-[10px] text-[var(--color-fg-muted)] tabular-nums">
          {locs.length} total · {overrideCount} with override
        </div>
      </div>
      {locs.length === 0 ? (
        <div className="text-[10px] text-[var(--color-fg-muted)]">
          Not used yet — instantiate from the Snippets panel to see this list populate.
        </div>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {locs.map((l) => {
            const isSnippetHost = l.screenId.startsWith("snippet:");
            const label = isSnippetHost ? l.screenId.slice("snippet:".length) : l.screenId;
            const current = isCurrent(l);
            return (
              <li key={`${l.screenId}:${l.path}`}>
                <button
                  type="button"
                  disabled={isSnippetHost || current}
                  onClick={async () => {
                    if (isSnippetHost || current) return;
                    await selectScreen(l.screenId);
                    setSelection({ screenId: l.screenId, path: l.path });
                  }}
                  title={
                    current
                      ? "This is the instance you're currently editing."
                      : isSnippetHost
                        ? `Used inside snippet "${label}" — open via Snippets list.`
                        : `Jump to ${l.screenId} · ${l.path === "" ? "(root)" : l.path}`
                  }
                  className={
                    current
                      ? "flex w-full items-center justify-between gap-2 rounded border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-1.5 py-1 text-left text-[10px] cursor-default"
                      : "flex w-full items-center justify-between gap-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-1 text-left text-[10px] hover:bg-[var(--color-surface)] disabled:opacity-60"
                  }
                >
                  <span
                    className={
                      current
                        ? "truncate text-[var(--color-accent)] font-medium"
                        : "truncate text-[var(--color-fg)]"
                    }
                  >
                    {current ? "● " : isSnippetHost ? "↳ snippet: " : ""}
                    {label}
                  </span>
                  <span className="shrink-0 font-mono text-[var(--color-fg-muted)]">
                    {l.path === "" ? "(root)" : l.path}
                  </span>
                  {l.hasOverride ? (
                    <span className="shrink-0 rounded bg-[var(--color-accent)]/10 px-1 text-[var(--color-accent)]">
                      override
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface ArgFieldProps {
  param: SnippetParam;
  initialValue: unknown;
  onChange: (v: unknown) => void;
  /** Full lucide name list from the manifest; only consumed by `type: "icon"`. */
  lucideIconNames: string[];
}

function ArgField({ param, initialValue, onChange, lucideIconNames }: ArgFieldProps) {
  const [value, setValue] = useState<string>(() => {
    if (initialValue === undefined || initialValue === null) return "";
    if (typeof initialValue === "string") return initialValue;
    return JSON.stringify(initialValue);
  });

  if (param.type === "boolean") {
    const checked = initialValue === true;
    return (
      <label
        className="flex items-center justify-between gap-3 text-xs"
        title={param.description ?? undefined}
      >
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
      <label className="flex flex-col gap-1 text-xs" title={param.description ?? undefined}>
        <span className="text-[var(--color-fg)]">{param.name}</span>
        <input
          type="number"
          className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
          value={value}
          min={param.min}
          max={param.max}
          step={param.step ?? 1}
          onChange={(e) => {
            setValue(e.target.value);
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
      </label>
    );
  }

  if (param.type === "icon") {
    return (
      <div className="flex flex-col gap-1 text-xs" title={param.description ?? undefined}>
        <span className="text-[var(--color-fg)]">{param.name}</span>
        <IconPicker
          value={typeof initialValue === "string" ? initialValue : ""}
          options={lucideIconNames}
          onChange={(name) => onChange(name)}
        />
      </div>
    );
  }

  if (param.type === "enum" && Array.isArray(param.enum) && param.enum.length > 0) {
    return (
      <label className="flex flex-col gap-1 text-xs" title={param.description ?? undefined}>
        <span className="text-[var(--color-fg)]">{param.name}</span>
        <select
          className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            onChange(e.target.value);
          }}
        >
          {param.enum.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (param.type === "color") {
    return (
      <label className="flex flex-col gap-1 text-xs" title={param.description ?? undefined}>
        <span className="text-[var(--color-fg)]">{param.name}</span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            className="h-7 w-9 cursor-pointer rounded border border-[var(--color-border)]"
            value={value.startsWith("#") ? value : "#000000"}
            onChange={(e) => {
              setValue(e.target.value);
              onChange(e.target.value);
            }}
          />
          <input
            type="text"
            className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              onChange(e.target.value);
            }}
          />
        </div>
      </label>
    );
  }

  return (
    <label className="flex flex-col gap-1 text-xs" title={param.description ?? undefined}>
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
