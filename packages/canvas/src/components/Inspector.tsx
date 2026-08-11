import { useEffect, useMemo, useRef } from "react";
import { mutate } from "../api.ts";
import { pathFromString } from "../path.ts";
import { selectedNode, useCanvas } from "../store.ts";
import { ClassesField } from "./ClassesField.tsx";
import { PropField } from "./PropField.tsx";

interface Props {
  pageId: string;
}

const DEBOUNCE_MS = 200;

export function Inspector({ pageId }: Props) {
  const selection = useCanvas((s) => s.selection);
  const components = useCanvas((s) => s.components);
  const currentPage = useCanvas((s) => s.currentPage);
  const loadComponents = useCanvas((s) => s.loadComponents);

  useEffect(() => {
    void loadComponents();
  }, [loadComponents]);

  const node = useMemo(() => selectedNode(currentPage, selection), [currentPage, selection]);
  const descriptor = useMemo(() => {
    if (!node || !components) return null;
    return components.find((c) => c.id === node.$ref) ?? null;
  }, [node, components]);

  const debouncePropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!selection) {
    return (
      <aside className="w-80 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col">
        <header className="px-4 py-3 border-b border-[var(--color-border)]">
          <span className="font-semibold text-sm">Inspector</span>
        </header>
        <div className="flex-1 grid place-items-center text-xs text-[var(--color-fg-muted)] p-6 text-center">
          Click a node in the canvas to edit its props.
        </div>
      </aside>
    );
  }

  if (!node) {
    return (
      <aside className="w-80 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col">
        <header className="px-4 py-3 border-b border-[var(--color-border)]">
          <span className="font-semibold text-sm">Inspector</span>
        </header>
        <div className="flex-1 grid place-items-center text-xs text-[var(--color-fg-muted)] p-6 text-center">
          Selected node is no longer in the tree.
        </div>
      </aside>
    );
  }

  const commitProp = (name: string, value: unknown) => {
    if (debouncePropTimer.current) clearTimeout(debouncePropTimer.current);
    debouncePropTimer.current = setTimeout(() => {
      void mutate.updateProps({
        pageId,
        variantId: selection.variantId,
        path: pathFromString(selection.path),
        propPatch: { [name]: value === undefined ? null : value },
      });
    }, DEBOUNCE_MS);
  };

  // Selection identity is what should trigger PropField remounts. Re-mounts
  // reseed local draft state, but only when the user picks a different node.
  const selectionKey = `${selection.variantId}:${selection.path}`;
  const initialClasses =
    typeof node.props?.className === "string" ? (node.props.className as string) : "";

  return (
    <aside className="w-80 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-hidden">
      <header className="px-4 py-3 border-b border-[var(--color-border)]">
        <div className="font-semibold text-sm">{node.$ref}</div>
        <div className="text-xs text-[var(--color-fg-muted)] mt-0.5">
          {selection.variantId} · {selection.path === "" ? "(root)" : selection.path}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {descriptor && descriptor.props.length > 0 ? (
          <section className="flex flex-col gap-3">
            <div className="text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
              Props
            </div>
            {descriptor.props
              .filter((p) => p.name !== "className")
              .map((p) => (
                <PropField
                  key={`${selectionKey}:${p.name}`}
                  descriptor={p}
                  initialValue={node.props?.[p.name]}
                  onChange={(v) => commitProp(p.name, v)}
                />
              ))}
          </section>
        ) : (
          <section className="text-xs text-[var(--color-fg-muted)]">
            No typed props extracted for {node.$ref}. Edit className below.
          </section>
        )}

        <ClassesField
          key={`${selectionKey}:className`}
          initialValue={initialClasses}
          pageId={pageId}
          variantId={selection.variantId}
          path={selection.path}
          debounceMs={DEBOUNCE_MS}
        />
      </div>
    </aside>
  );
}
