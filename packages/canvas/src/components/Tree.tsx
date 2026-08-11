import type { Node, Variant } from "@velloo/schema";
import { useMemo, useState } from "react";
import { pathFromString, pathToString } from "../path.ts";
import { useCanvas } from "../store.ts";

interface Props {
  variant: Variant;
}

/**
 * Short label for a node row. Falls back to the first useful hint we can
 * extract: a string `children` prop, a `placeholder`, a `label`, or a
 * className snippet — none of which is the source of truth, but all of which
 * help a human map a row to a thing on screen.
 */
function describeNode(node: Node): string | null {
  const p = node.props;
  if (!p) return null;
  const candidates = ["children", "label", "placeholder", "value", "title"];
  for (const key of candidates) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) {
      const t = v.trim();
      return t.length > 28 ? `${t.slice(0, 27)}…` : t;
    }
    if (typeof v === "number") return String(v);
  }
  if (typeof p.className === "string") {
    const cn = p.className.trim();
    if (cn) return `.${cn.split(/\s+/)[0]}`;
  }
  return null;
}

interface RowProps {
  node: Node;
  path: number[];
  variantId: string;
  depth: number;
  expandedSet: Set<string>;
  setExpanded: (path: string, expanded: boolean) => void;
}

function TreeRow({ node, path, variantId, depth, expandedSet, setExpanded }: RowProps) {
  const pathStr = pathToString(path);
  const setSelection = useCanvas((s) => s.setSelection);
  const setHover = useCanvas((s) => s.setHover);
  const selection = useCanvas((s) => s.selection);
  const hover = useCanvas((s) => s.hover);

  const isSelected = selection?.variantId === variantId && selection.path === pathStr;
  const isHovered = hover?.variantId === variantId && hover.path === pathStr;
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isOpen = hasChildren ? expandedSet.has(pathStr) : false;
  const description = describeNode(node);

  const rowClass = [
    "w-full flex items-center gap-1 px-2 py-1 rounded-sm text-sm cursor-default select-none text-left",
    isSelected
      ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
      : isHovered
        ? "bg-[var(--color-bg)]"
        : "hover:bg-[var(--color-bg)] text-[var(--color-fg)]",
  ].join(" ");

  return (
    <div>
      <div className={rowClass} style={{ paddingLeft: `${0.5 + depth * 0.875}rem` }}>
        <button
          type="button"
          onClick={() => setExpanded(pathStr, !isOpen)}
          className="inline-flex w-4 h-4 items-center justify-center text-xs opacity-60 shrink-0"
          aria-label={isOpen ? "Collapse" : "Expand"}
          disabled={!hasChildren}
        >
          {hasChildren ? (isOpen ? "▾" : "▸") : ""}
        </button>
        <button
          type="button"
          onClick={() => setSelection({ variantId, path: pathStr })}
          onMouseEnter={() => setHover({ variantId, path: pathStr })}
          onMouseLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" && hasChildren && !isOpen) {
              e.preventDefault();
              setExpanded(pathStr, true);
            } else if (e.key === "ArrowLeft" && hasChildren && isOpen) {
              e.preventDefault();
              setExpanded(pathStr, false);
            }
          }}
          className="flex flex-1 min-w-0 items-center gap-1 text-left text-inherit"
        >
          <span className="font-medium">{node.$ref}</span>
          {description ? (
            <span
              className={
                "truncate text-xs opacity-70 " +
                (isSelected ? "text-[var(--color-accent-fg)]" : "text-[var(--color-fg-muted)]")
              }
            >
              {description}
            </span>
          ) : null}
        </button>
      </div>
      {hasChildren && isOpen ? (
        <div>
          {node.children?.map((child, i) => {
            const childPath = `${pathStr === "" ? "" : `${pathStr}.`}${i}`;
            return (
              <TreeRow
                key={childPath}
                node={child}
                path={[...path, i]}
                variantId={variantId}
                depth={depth + 1}
                expandedSet={expandedSet}
                setExpanded={setExpanded}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Collect every ancestor path of `target` so we can auto-expand to it. */
function ancestorsOf(target: number[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < target.length; i++) {
    out.add(pathToString(target.slice(0, i)));
  }
  return out;
}

/** Collect every node path in the tree (used to default-expand everything). */
function allPaths(node: Node, path: number[] = [], out: Set<string> = new Set()): Set<string> {
  out.add(pathToString(path));
  if (node.children) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child) allPaths(child, [...path, i], out);
    }
  }
  return out;
}

export function Tree({ variant }: Props) {
  const selection = useCanvas((s) => s.selection);

  // Default: every node expanded so the structure is visible at a glance.
  // User can collapse; selection auto-expands ancestors on top of whatever
  // the user's current expansion state is.
  const [expandedSet, setExpandedState] = useState<Set<string>>(() => allPaths(variant.tree));

  const setExpanded = (pathStr: string, expanded: boolean) => {
    setExpandedState((prev) => {
      const next = new Set(prev);
      if (expanded) next.add(pathStr);
      else next.delete(pathStr);
      return next;
    });
  };

  // Auto-expand ancestors when selection lands on this variant.
  const effectiveExpanded = useMemo(() => {
    if (selection?.variantId !== variant.id) return expandedSet;
    const auto = ancestorsOf(pathFromString(selection.path));
    const merged = new Set(expandedSet);
    for (const a of auto) merged.add(a);
    return merged;
  }, [expandedSet, selection, variant.id]);

  return (
    <div className="flex flex-col py-1">
      <TreeRow
        node={variant.tree}
        path={[]}
        variantId={variant.id}
        depth={0}
        expandedSet={effectiveExpanded}
        setExpanded={setExpanded}
      />
    </div>
  );
}
