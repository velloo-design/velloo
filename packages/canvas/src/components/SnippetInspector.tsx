import type { Snippet, SnippetInstance, SnippetParam } from "@velloo/schema";
import { useEffect, useState } from "react";
import { fetchSnippet, mutate, type SnippetMeta } from "../api.ts";
import { useDebouncedCommit } from "../hooks/useDebouncedCommit.ts";
import { useIconNames } from "../hooks/useIconNames.ts";
import { pathFromString } from "../path.ts";
import { type Selection, useCanvas } from "../store.ts";
import { ValueField, type ValueKind } from "./ValueField.tsx";

const DEBOUNCE_MS = 200;

interface Props {
  selection: Selection;
  node: SnippetInstance;
}

/**
 * Inspector for a `$snippet` instance. Shows the snippet's declared
 * params as editable fields and patches the instance's `args` map.
 * Editing the snippet body itself happens elsewhere — the file system
 * or a future "open snippet" canvas mode.
 */
export function SnippetInspector({ selection, node }: Props) {
  const design = useCanvas((s) => s.design);
  const snippetMeta: SnippetMeta | undefined = design?.snippets.find((s) => s.id === node.$snippet);
  const lucideIconNames = useIconNames();

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

  // The payload captures screenId/path at edit time, so a selection change
  // inside the debounce window can't redirect a pending commit.
  const pushArg = useDebouncedCommit<{
    screenId: string;
    path: string;
    name: string;
    value: unknown;
  }>(DEBOUNCE_MS, (p) => {
    void mutate
      .updateSnippetArgs({
        screenId: p.screenId,
        path: pathFromString(p.path),
        argPatch: { [p.name]: p.value === undefined ? null : p.value },
      })
      .catch(() => undefined);
  });
  const commitArg = (name: string, value: unknown) =>
    pushArg({ screenId: selection.screenId, path: selection.path, name, value });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-4 py-3 border-b">
        <div className="font-semibold text-sm truncate">@{node.$snippet}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {selection.screenId} · {selection.path === "" ? "(root)" : selection.path} · snippet
          instance
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {snippetMeta == null ? (
          <div className="text-xs text-muted-foreground">
            Snippet "{node.$snippet}" is not in the registry — the instance is dangling.
          </div>
        ) : params.length === 0 ? (
          <div className="text-xs text-muted-foreground">This snippet takes no params.</div>
        ) : (
          <section className="flex flex-col gap-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Args</div>
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

function SnippetInstances({ snippetId, selection }: { snippetId: string; selection: Selection }) {
  const [locs, setLocs] = useState<InstanceLocation[] | null>(null);
  const screenVersion = useCanvas((s) => s.screenVersion);
  const selectScreen = useCanvas((s) => s.selectScreen);
  const setSelection = useCanvas((s) => s.setSelection);

  useEffect(() => {
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
    <section className="flex flex-col gap-2 border-t pt-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Instances</div>
        <div className="text-[10px] text-muted-foreground tabular-nums">
          {locs.length} total · {overrideCount} with override
        </div>
      </div>
      {locs.length === 0 ? (
        <div className="text-[10px] text-muted-foreground">
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
                      ? "flex w-full items-center justify-between gap-2 rounded-md border border-primary bg-primary/10 px-1.5 py-1 text-left text-[10px] cursor-default"
                      : "flex w-full items-center justify-between gap-2 rounded-md border bg-background px-1.5 py-1 text-left text-[10px] hover:bg-muted disabled:opacity-60"
                  }
                >
                  <span
                    className={
                      current ? "truncate text-primary font-medium" : "truncate text-foreground"
                    }
                  >
                    {current ? "● " : isSnippetHost ? "↳ snippet: " : ""}
                    {label}
                  </span>
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {l.path === "" ? "(root)" : l.path}
                  </span>
                  {l.hasOverride ? (
                    <span className="shrink-0 rounded bg-primary/10 px-1 text-primary">
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

function argKind(param: SnippetParam): ValueKind {
  switch (param.type) {
    case "boolean":
    case "number":
    case "icon":
    case "color":
      return param.type;
    case "enum":
      return Array.isArray(param.enum) && param.enum.length > 0 ? "enum" : "string";
    default:
      // `node` args are edited as raw text here, matching the historical field.
      return "string";
  }
}

function ArgField({ param, initialValue, onChange, lucideIconNames }: ArgFieldProps) {
  const kind = argKind(param);
  return (
    <ValueField
      kind={kind}
      id={`snip-arg-${param.name}`}
      name={param.name}
      label={param.name}
      labelClassName="text-xs"
      title={param.description ?? undefined}
      initialValue={initialValue}
      onCommit={onChange}
      enumValues={param.enum}
      iconNames={lucideIconNames}
      min={param.min}
      max={param.max}
      step={param.step ?? 1}
      placeholder={kind === "enum" ? "(choose)" : undefined}
    />
  );
}
