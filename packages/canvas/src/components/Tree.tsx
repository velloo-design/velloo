import type { ComponentDescriptor } from "@velloo/provider";
import {
  isComponentNode,
  isParamRef,
  isSnippetInstance,
  type Node,
  nodeId,
  type Screen,
} from "@velloo/schema";
import { Crosshair, PanelsTopLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { nodeRung } from "../node-typography.ts";
import { pathFromString, pathToString } from "../path.ts";
import { useCanvas } from "../store.ts";
import { Badge } from "./ui/badge.tsx";

interface Props {
  screen: Screen;
}

function describeNode(node: Node): string | null {
  if (isSnippetInstance(node)) {
    const argEntries = Object.entries(node.args ?? {});
    const first = argEntries.find(([, v]) => typeof v === "string" && (v as string).trim());
    if (first) {
      const v = (first[1] as string).trim();
      return v.length > 28 ? `${v.slice(0, 27)}…` : v;
    }
    return argEntries.length > 0 ? `${argEntries.length} args` : null;
  }
  if (isParamRef(node)) return null;
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

function nodeLabel(node: Node): string {
  if (isSnippetInstance(node)) return `@${node.$snippet}`;
  if (isParamRef(node)) return `\${${node.$param}}`;
  const rung = nodeRung(node);
  // A velloo screen is mostly `Box`, tagged by `as` — so the ref alone labels
  // every row identically and the tree stops telling you anything. The tag is
  // what distinguishes a heading from a cell.
  const as = typeof node.props?.as === "string" ? node.props.as : null;
  const base = as && as !== "div" ? `${node.$ref} ${as}` : node.$ref;
  return rung ? `${base} ${rung}` : base;
}

function nodeChildren(node: Node): Node[] | undefined {
  return isComponentNode(node) ? node.children : undefined;
}

/** `/api/components` tags entries with `kind`; the Manifest type predates it. */
type LibraryEntry = ComponentDescriptor & { kind?: "library" | "extension" | "snippet" };

interface Provenance {
  tone: string;
  title: string;
}

/**
 * Where a row's `$ref` comes from. Velloo helpers deliberately return null:
 * a screen is overwhelmingly `Box`, so marking those would bury the one
 * signal this carries — which rows are the project's real components.
 *
 * A dot rather than the library's name: the name is the same on every row of
 * a given folder, so it spends width restating the folder's target while
 * pushing the class hint out of a tree that is already indented deep. Which
 * library it is belongs in the tooltip, where it's asked for, not on 200 rows.
 */
function provenanceOf(node: Node, byId: Map<string, LibraryEntry>): Provenance | null {
  if (!isComponentNode(node)) return null;
  const entry = byId.get(node.$ref);
  if (!entry) {
    return {
      tone: "bg-destructive",
      title: `${node.$ref} isn't in this screen's library — it renders as a fallback.`,
    };
  }
  if (entry.kind === "extension") {
    return {
      tone: "bg-transparent ring-1 ring-inset ring-primary",
      title: `${node.$ref} — a custom component registered with add_extension.`,
    };
  }
  if (entry.source === "velloo") return null;
  return {
    tone: "bg-primary",
    title: `${node.$ref} — a real ${entry.source} component from this project's library.`,
  };
}

interface RowProps {
  node: Node;
  path: number[];
  screenId: string;
  depth: number;
  expandedSet: Set<string>;
  setExpanded: (path: string, expanded: boolean) => void;
  byId: Map<string, LibraryEntry>;
}

function TreeRow({ node, path, screenId, depth, expandedSet, setExpanded, byId }: RowProps) {
  const pathStr = pathToString(path);
  const setSelection = useCanvas((s) => s.setSelection);
  const setHover = useCanvas((s) => s.setHover);
  const openSnippetEditor = useCanvas((s) => s.openSnippetEditor);

  // Subscribe to the derived booleans, not the selection/hover objects: a
  // hover change then re-renders the two affected rows instead of every row
  // in the tree — the difference between instant and laggy hover on big
  // screens.
  const isSelected = useCanvas(
    (s) => s.selection?.screenId === screenId && s.selection.path === pathStr,
  );
  const isHovered = useCanvas((s) => s.hover?.screenId === screenId && s.hover.path === pathStr);

  // When selection arrives from outside the tree (a canvas click), reveal the
  // row. `block: "nearest"` scrolls the sidebar the minimum amount — never a
  // jump when the row is already visible.
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isSelected) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isSelected]);

  const childList = nodeChildren(node);
  const hasChildren = (childList?.length ?? 0) > 0;
  const isOpen = hasChildren ? expandedSet.has(pathStr) : false;
  const description = describeNode(node);
  const snippetRef = isSnippetInstance(node) ? node.$snippet : null;
  const provenance = provenanceOf(node, byId);

  const rowClass = [
    "w-full flex items-center gap-1 px-2 py-1 rounded-sm text-sm cursor-default select-none text-left group/row",
    isSelected
      ? "bg-primary text-primary-foreground"
      : isHovered
        ? "bg-muted"
        : "hover:bg-muted text-foreground",
  ].join(" ");

  const select = () => setSelection({ screenId, path: pathStr });

  return (
    <div>
      <div ref={rowRef} className={rowClass} style={{ paddingLeft: `${0.5 + depth * 0.875}rem` }}>
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
          onClick={select}
          onDoubleClick={() => {
            // Double-clicking a snippet instance jumps to the focused
            // snippet view — the same affordance as Library Detail's
            // "Open in canvas" button. For non-snippet rows the dblclick
            // is a no-op (single-click already selected the row).
            if (snippetRef) openSnippetEditor(snippetRef);
          }}
          onMouseEnter={() => setHover({ screenId, path: pathStr })}
          onMouseLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" && hasChildren && !isOpen) {
              e.preventDefault();
              setExpanded(pathStr, true);
            } else if (e.key === "ArrowLeft" && hasChildren && isOpen) {
              e.preventDefault();
              setExpanded(pathStr, false);
            } else if (e.key === "Enter" && snippetRef) {
              e.preventDefault();
              openSnippetEditor(snippetRef);
            }
          }}
          className="flex flex-1 min-w-0 items-center gap-1 text-left text-inherit"
          title={snippetRef ? `Double-click or Enter to open ${snippetRef} in canvas` : undefined}
        >
          <span className="font-medium">{nodeLabel(node)}</span>
          {provenance ? (
            <span
              role="img"
              aria-label={provenance.title}
              className={
                "size-1.5 shrink-0 rounded-full " +
                (isSelected ? "bg-primary-foreground" : provenance.tone)
              }
              title={provenance.title}
            />
          ) : null}
          {nodeId(node) ? (
            <Badge
              variant="outline"
              className={
                "shrink-0 px-1 py-0 font-mono text-[10px] leading-none " +
                (isSelected
                  ? "border-primary-foreground/40 text-primary-foreground"
                  : "text-muted-foreground")
              }
              title={`Stable anchor: @${nodeId(node)}`}
            >
              @{nodeId(node)}
            </Badge>
          ) : null}
          {description ? (
            <span
              className={
                "truncate text-xs opacity-70 " +
                (isSelected ? "text-primary-foreground" : "text-muted-foreground")
              }
            >
              {description}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void useCanvas.getState().locateNode(screenId, pathStr);
          }}
          className={
            "shrink-0 inline-flex items-center justify-center w-5 h-5 rounded opacity-0 group-hover/row:opacity-70 hover:opacity-100 transition-opacity " +
            (isSelected ? "text-primary-foreground" : "text-muted-foreground")
          }
          aria-label="Locate on canvas"
          title="Locate on canvas (centers and zooms to this node)"
          data-locate-node={pathStr}
        >
          <Crosshair size={11} strokeWidth={2} />
        </button>
        {snippetRef ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openSnippetEditor(snippetRef);
            }}
            className={
              "shrink-0 inline-flex items-center justify-center w-5 h-5 rounded opacity-0 group-hover/row:opacity-70 hover:opacity-100 transition-opacity " +
              (isSelected ? "text-primary-foreground" : "text-muted-foreground")
            }
            aria-label={`Open ${snippetRef} in canvas`}
            title={`Open ${snippetRef} in canvas`}
          >
            <PanelsTopLeft size={11} strokeWidth={2} />
          </button>
        ) : null}
      </div>
      {hasChildren && isOpen ? (
        <div>
          {childList?.map((child, i) => {
            const childPath = `${pathStr === "" ? "" : `${pathStr}.`}${i}`;
            return (
              <TreeRow
                key={childPath}
                node={child}
                path={[...path, i]}
                screenId={screenId}
                depth={depth + 1}
                expandedSet={expandedSet}
                setExpanded={setExpanded}
                byId={byId}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ancestorsOf(target: number[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < target.length; i++) {
    out.add(pathToString(target.slice(0, i)));
  }
  return out;
}

function allPaths(node: Node, path: number[] = [], out: Set<string> = new Set()): Set<string> {
  out.add(pathToString(path));
  const children = nodeChildren(node);
  if (children) {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child) allPaths(child, [...path, i], out);
    }
  }
  return out;
}

export function Tree({ screen }: Props) {
  const selection = useCanvas((s) => s.selection);
  const components = useCanvas((s) => s.components);
  const loadComponents = useCanvas((s) => s.loadComponents);

  // The tree is reachable without ever opening the library or the inspector,
  // so it can't assume the manifest is already in the store.
  useEffect(() => {
    void loadComponents();
  }, [loadComponents]);

  const byId = useMemo(
    () => new Map((components ?? []).map((c) => [c.id, c as LibraryEntry])),
    [components],
  );

  const [expandedSet, setExpandedState] = useState<Set<string>>(() => allPaths(screen.tree));

  const setExpanded = (pathStr: string, expanded: boolean) => {
    setExpandedState((prev) => {
      const next = new Set(prev);
      if (expanded) next.add(pathStr);
      else next.delete(pathStr);
      return next;
    });
  };

  const effectiveExpanded = useMemo(() => {
    if (selection?.screenId !== screen.id) return expandedSet;
    const auto = ancestorsOf(pathFromString(selection.path));
    const merged = new Set(expandedSet);
    for (const a of auto) merged.add(a);
    return merged;
  }, [expandedSet, selection, screen.id]);

  return (
    <div className="flex flex-col py-1">
      <TreeRow
        node={screen.tree}
        path={[]}
        screenId={screen.id}
        depth={0}
        expandedSet={effectiveExpanded}
        setExpanded={setExpanded}
        byId={byId}
      />
    </div>
  );
}
