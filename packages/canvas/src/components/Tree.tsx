import {
  isComponentNode,
  isParamRef,
  isSnippetInstance,
  type Node,
  nodeId,
  type Screen,
} from "@velloo/schema";
import { ChevronRight, Crosshair, PanelsTopLeft, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { mutate, undo } from "../api.ts";
import { nodeRung } from "../node-typography.ts";
import { pathFromString, pathToString } from "../path.ts";
import { useCanvas } from "../store.ts";
import { pushToast, toastError } from "../toast.ts";
import { type LibraryEntry, type NodeIcon, nodeIcon } from "../tree-icons.ts";
import { Badge } from "./ui/badge.tsx";

interface Props {
  screen: Screen;
}

/**
 * Rows size to their content so the tree scrolls sideways rather than
 * squeezing, which makes an unbounded string set the scroll width for every
 * row. A single Tailwind class is easily longer than the pane is wide
 * (`data-[state=open]:bg-accent`), so classes are clamped like any other text.
 */
const clamp = (s: string, max = 28) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Kept in step with the `duration-200` on the subtree wrapper. */
const SUBTREE_MS = 200;

function describeNode(node: Node): string | null {
  if (isSnippetInstance(node)) {
    const argEntries = Object.entries(node.args ?? {});
    const first = argEntries.find(([, v]) => typeof v === "string" && (v as string).trim());
    if (first) return clamp((first[1] as string).trim());
    return argEntries.length > 0 ? `${argEntries.length} args` : null;
  }
  if (isParamRef(node)) return null;
  const p = node.props;
  if (!p) return null;
  const candidates = ["children", "label", "placeholder", "value", "title"];
  for (const key of candidates) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) return clamp(v.trim());
    if (typeof v === "number") return String(v);
  }
  if (typeof p.className === "string") {
    const cn = p.className.trim();
    if (cn) return clamp(`.${cn.split(/\s+/)[0]}`);
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

/**
 * Whether a subtree's rows are in the DOM, and whether its height is moving.
 *
 * A closing branch stays mounted for the length of the animation so there is
 * something to animate away, then leaves: a screen's tree is deep enough that
 * keeping every collapsed branch rendered is the cost the collapse exists to
 * avoid.
 */
function useSubtree(open: boolean): { mounted: boolean; animating: boolean } {
  const [mounted, setMounted] = useState(open);
  const [wasOpen, setWasOpen] = useState(open);
  const [animating, setAnimating] = useState(false);

  // Derived during render rather than in an effect: the rows have to exist in
  // the same commit that flips the track to `1fr`, or the transition has no
  // height to move towards and the branch just appears.
  if (wasOpen !== open) {
    setWasOpen(open);
    setAnimating(true);
    if (open) setMounted(true);
  }

  useEffect(() => {
    if (!animating) return;
    const timer = setTimeout(() => {
      setAnimating(false);
      if (!open) setMounted(false);
    }, SUBTREE_MS);
    return () => clearTimeout(timer);
  }, [animating, open]);

  return { mounted, animating };
}

function RowIcon({ icon, selected }: { icon: NodeIcon; selected: boolean }) {
  const className = `shrink-0 ${selected ? "text-primary-foreground" : icon.tone}`;
  if (!icon.title) return <icon.Icon size={13} strokeWidth={2} className={className} aria-hidden />;
  return (
    <span
      role="img"
      aria-label={icon.title}
      title={icon.title}
      className={`inline-flex ${className}`}
    >
      <icon.Icon size={13} strokeWidth={2} aria-hidden />
    </span>
  );
}

const ACTION_CLASS =
  "inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

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
  const { mounted, animating } = useSubtree(isOpen);
  const description = describeNode(node);
  const snippetRef = isSnippetInstance(node) ? node.$snippet : null;
  const icon = nodeIcon(node, byId);

  const rowClass = [
    "w-full flex items-center gap-1 px-2 py-1 rounded-sm text-sm cursor-default select-none text-left group/row",
    isSelected
      ? "bg-primary text-primary-foreground"
      : isHovered
        ? "bg-muted"
        : "hover:bg-muted text-foreground",
  ].join(" ");

  const select = () => setSelection({ screenId, path: pathStr });

  const removeThisNode = () => {
    void (async () => {
      try {
        const { removedRef } = await mutate.removeNode({ screenId, path });
        const state = useCanvas.getState();
        if (
          state.selection?.screenId === screenId &&
          (state.selection.path === pathStr || state.selection.path.startsWith(`${pathStr}.`))
        ) {
          state.setSelection(null);
        }
        state.setHover(null);
        void state.refreshHistory();
        pushToast({
          kind: "info",
          message: `Removed ${removedRef}`,
          action: {
            label: "Undo",
            onClick: () => {
              void undo()
                .catch((e) => toastError(e, "Undo failed"))
                .finally(() => void useCanvas.getState().refreshHistory());
            },
          },
        });
      } catch (e) {
        toastError(e, "Could not remove node");
      }
    })();
  };

  return (
    <div>
      <div ref={rowRef} className={rowClass} style={{ paddingLeft: `${0.5 + depth * 0.875}rem` }}>
        <button
          type="button"
          onClick={() => setExpanded(pathStr, !isOpen)}
          className={
            "inline-flex size-5 shrink-0 items-center justify-center rounded transition-colors disabled:opacity-0 " +
            (isSelected
              ? "text-primary-foreground hover:bg-primary-foreground/20"
              : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground")
          }
          aria-label={isOpen ? "Collapse" : "Expand"}
          disabled={!hasChildren}
        >
          <ChevronRight
            size={15}
            strokeWidth={2.5}
            aria-hidden
            className={
              "transition-transform duration-200 motion-reduce:transition-none " +
              (isOpen ? "rotate-90" : "")
            }
          />
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
          className="flex shrink-0 items-center gap-1.5 text-left text-inherit"
          title={snippetRef ? `Double-click or Enter to open ${snippetRef} in canvas` : undefined}
        >
          <RowIcon icon={icon} selected={isSelected} />
          <span className="font-medium whitespace-nowrap">{nodeLabel(node)}</span>
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
                "whitespace-nowrap text-xs opacity-70 " +
                (isSelected ? "text-primary-foreground" : "text-muted-foreground")
              }
            >
              {description}
            </span>
          ) : null}
        </button>
        {/* The tree scrolls sideways and every row is as wide as the widest
            one, so actions simply parked at the row's end spend most of their
            life past the right edge. Sticking them there keeps them on the
            pane's edge instead, over the empty tail of the row rather than
            over its name. Inert until the row is hovered, so the invisible
            group can't eat a click. */}
        <div className="pointer-events-none sticky right-1 z-10 ml-auto flex shrink-0 items-center gap-px rounded-md border bg-popover px-px text-popover-foreground opacity-0 shadow-sm transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void useCanvas.getState().locateNode(screenId, pathStr);
            }}
            className={ACTION_CLASS}
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
              className={ACTION_CLASS}
              aria-label={`Open ${snippetRef} in canvas`}
              title={`Open ${snippetRef} in canvas`}
            >
              <PanelsTopLeft size={11} strokeWidth={2} />
            </button>
          ) : null}
          {/* Not on the root: `remove_node` reads a root locator as "empty the
              screen", which is not what a row's delete button promises. */}
          {depth === 0 ? null : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeThisNode();
              }}
              className={`${ACTION_CLASS} hover:bg-destructive/10 hover:text-destructive`}
              aria-label="Delete node"
              title="Delete this node (undoable)"
              data-remove-node={pathStr}
            >
              <Trash2 size={11} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
      {hasChildren ? (
        <div
          className={
            "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none " +
            (isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")
          }
        >
          {/* Clipped only while the track moves. A permanent `overflow-hidden`
              would become the scrollport every nested row's sticky actions
              measure against, and they'd stop tracking the pane's edge. */}
          <div className={isOpen && !animating ? "" : "overflow-hidden"}>
            {mounted
              ? childList?.map((child, i) => {
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
                })
              : null}
          </div>
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

  // `w-max` sizes the tree to its widest row so the sidebar's overflow-auto
  // scrolls horizontally; `min-w-full` keeps it filling the pane when every
  // row is short. Rows are `w-full` of *that*, so a selected row's background
  // spans the full scroll width instead of stopping at the viewport edge.
  return (
    <div className="flex w-max min-w-full flex-col py-1">
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
