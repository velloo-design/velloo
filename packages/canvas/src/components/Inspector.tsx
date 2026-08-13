import { isComponentNode, isSnippetInstance } from "@velloo/schema";
import { useEffect, useMemo, useRef } from "react";
import { mutate } from "../api.ts";
import { pathFromString } from "../path.ts";
import { selectedNode, useCanvas } from "../store.ts";
import { ClassesField } from "./ClassesField.tsx";
import { CopyField } from "./CopyField.tsx";
import { PropField } from "./PropField.tsx";
import { SnippetInspector } from "./SnippetInspector.tsx";
import { Toggle } from "./Toggle.tsx";

interface Props {
  pageId: string;
}

const DEBOUNCE_MS = 200;
/** Props the inspector hides — they're either composition primitives or
 * surfaced with their own dedicated field below. */
const HIDDEN_PROPS = new Set(["className", "asChild", "children"]);

export function Inspector({ pageId }: Props) {
  const selection = useCanvas((s) => s.selection);
  const components = useCanvas((s) => s.components);
  const currentPage = useCanvas((s) => s.currentPage);
  const loadComponents = useCanvas((s) => s.loadComponents);
  const syncEdits = useCanvas((s) => s.syncEdits);
  const setSyncEdits = useCanvas((s) => s.setSyncEdits);

  useEffect(() => {
    void loadComponents();
  }, [loadComponents]);

  const node = useMemo(() => selectedNode(currentPage, selection), [currentPage, selection]);
  const descriptor = useMemo(() => {
    if (!node || !components || !isComponentNode(node)) return null;
    return components.find((c) => c.id === node.$ref) ?? null;
  }, [node, components]);

  const debouncePropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!selection) {
    return (
      <div className="flex-1 grid place-items-center text-xs text-[var(--color-fg-muted)] p-6 text-center">
        Click a node in the canvas to edit its props.
      </div>
    );
  }

  if (!node) {
    return (
      <div className="flex-1 grid place-items-center text-xs text-[var(--color-fg-muted)] p-6 text-center">
        Selected node is no longer in the tree.
      </div>
    );
  }

  // Snippet instances get a dedicated inspector — different shape (args, not props).
  if (isSnippetInstance(node)) {
    return <SnippetInspector pageId={pageId} selection={selection} node={node} />;
  }

  // Param refs are only valid inside snippet bodies — we don't currently surface
  // them in the page tree, but render an explanatory note if one shows up.
  if (!isComponentNode(node)) {
    return (
      <div className="flex-1 grid place-items-center text-xs text-[var(--color-fg-muted)] p-6 text-center">
        $param placeholders are only addressable inside a snippet body — open the snippet to edit.
      </div>
    );
  }

  // When sync is on, broadcast edits across every variant in the current page.
  const variantIds = syncEdits
    ? (currentPage?.variants.map((v) => v.id) ?? [selection.variantId])
    : [selection.variantId];

  const commitProp = (name: string, value: unknown) => {
    if (debouncePropTimer.current) clearTimeout(debouncePropTimer.current);
    debouncePropTimer.current = setTimeout(() => {
      const path = pathFromString(selection.path);
      for (const variantId of variantIds) {
        void mutate
          .updateProps({
            pageId,
            variantId,
            path,
            propPatch: { [name]: value === undefined ? null : value },
          })
          .catch(() => undefined);
      }
    }, DEBOUNCE_MS);
  };

  // Selection identity drives PropField remounts so local draft state stays
  // fresh per selected node.
  const selectionKey = `${selection.variantId}:${selection.path}`;
  const initialClasses =
    typeof node.props?.className === "string" ? (node.props.className as string) : "";
  const childrenValue =
    typeof node.props?.children === "string" ? (node.props.children as string) : "";
  const showCopy = typeof node.props?.children === "string" || descriptor === null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-4 py-3 border-b border-[var(--color-border)]">
        <div className="font-semibold text-sm truncate">{node.$ref}</div>
        <div className="text-xs text-[var(--color-fg-muted)] mt-0.5">
          {selection.variantId} · {selection.path === "" ? "(root)" : selection.path}
        </div>
      </header>

      <StatePreview key={selectionKey} />

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {showCopy ? (
          <CopyField
            key={`${selectionKey}:children`}
            initialValue={childrenValue}
            pageId={pageId}
            variantIds={variantIds}
            path={selection.path}
            debounceMs={DEBOUNCE_MS}
          />
        ) : null}

        {descriptor && descriptor.props.filter((p) => !HIDDEN_PROPS.has(p.name)).length > 0 ? (
          <section className="flex flex-col gap-3">
            <div className="text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
              Props
            </div>
            {descriptor.props
              .filter((p) => !HIDDEN_PROPS.has(p.name))
              .map((p) => (
                <PropField
                  key={`${selectionKey}:${p.name}`}
                  descriptor={p}
                  initialValue={node.props?.[p.name]}
                  onChange={(v) => commitProp(p.name, v)}
                />
              ))}
          </section>
        ) : null}

        <ClassesField
          key={`${selectionKey}:className`}
          initialValue={initialClasses}
          pageId={pageId}
          variantIds={variantIds}
          path={selection.path}
          debounceMs={DEBOUNCE_MS}
        />
      </div>

      <footer className="border-t border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium">Sync across variants</span>
          <span className="text-[10px] text-[var(--color-fg-muted)] leading-tight mt-0.5">
            Edits apply to every variant on this page.
          </span>
        </div>
        <Toggle
          id="sync-toggle"
          checked={syncEdits}
          onChange={setSyncEdits}
          label="Sync edits across variants"
        />
      </footer>
    </div>
  );
}

const STATES = ["default", "hover", "focus", "active", "disabled"] as const;

/**
 * "Preview state" picker. Mounted fresh per selection (via `key`) so the
 * dropdown resets to "default" whenever the user clicks a different node.
 */
function StatePreview() {
  const nodeState = useCanvas((s) => s.nodeState);
  const setNodeState = useCanvas((s) => s.setNodeState);

  useEffect(() => {
    // On mount (new selection), reset to default. The cleanup also resets so
    // we don't carry a forced state across selections.
    setNodeState("default");
    return () => setNodeState("default");
  }, [setNodeState]);

  return (
    <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-2">
      <label
        htmlFor="node-state"
        className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider"
      >
        State
      </label>
      <select
        id="node-state"
        value={nodeState}
        onChange={(e) => setNodeState(e.target.value as typeof nodeState)}
        className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs"
      >
        {STATES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}
