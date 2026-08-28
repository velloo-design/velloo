import { Frame as FrameIcon, LayoutGrid, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  fetchSearch,
  type SearchBoardHit,
  type SearchResponse,
  type SearchScreenHit,
  type SearchTextHit,
} from "../api.ts";
import { pathToString } from "../path.ts";
import { useCanvas } from "../store.ts";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog.tsx";

/**
 * The Ctrl/Cmd+K search dialog: boards, screens, and text content across the
 * whole design folder, grouped with filter chips and full breadcrumbs.
 * Selecting a result navigates there — board results switch boards, screen
 * results center the screen's frame, text results additionally select the
 * matched node and scroll it into view inside its frame.
 */

type Filter = "all" | "boards" | "screens" | "text";

const FILTER_CYCLE: Filter[] = ["all", "boards", "screens", "text"];

type Item =
  | { kind: "board"; hit: SearchBoardHit }
  | { kind: "screen"; hit: SearchScreenHit }
  | { kind: "text"; hit: SearchTextHit };

export function SearchDialog() {
  const open = useCanvas((s) => s.searchOpen);
  const setOpen = useCanvas((s) => s.setSearchOpen);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const seqRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Fresh state per open — a palette re-opens empty, not on the stale query.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults(null);
    setFilter("all");
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q === "") {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      const seq = ++seqRef.current;
      fetchSearch(q)
        .then((r) => {
          if (seq !== seqRef.current) return; // a newer query answered first
          setResults(r);
          setActiveIndex(0);
        })
        .catch(() => {
          /* transient — the next keystroke retries */
        });
    }, 120);
    return () => clearTimeout(t);
  }, [query, open]);

  const groups = useMemo(() => {
    if (!results) return { boards: [], screens: [], text: [] };
    return {
      boards: filter === "all" || filter === "boards" ? results.boards : [],
      screens: filter === "all" || filter === "screens" ? results.screens : [],
      text: filter === "all" || filter === "text" ? results.text : [],
    };
  }, [results, filter]);

  // One flat list in render order — the ↑↓ cursor walks across group
  // boundaries transparently.
  const items = useMemo<Item[]>(
    () => [
      ...groups.boards.map((hit): Item => ({ kind: "board", hit })),
      ...groups.screens.map((hit): Item => ({ kind: "screen", hit })),
      ...groups.text.map((hit): Item => ({ kind: "text", hit })),
    ],
    [groups],
  );
  const active = Math.min(activeIndex, Math.max(0, items.length - 1));

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-result-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = async (item: Item) => {
    setOpen(false);
    const state = useCanvas.getState();
    if (state.view !== "boards") state.setView("boards");

    if (item.kind === "board") {
      await state.selectBoard(item.hit.id);
      return;
    }

    const screenId = item.kind === "screen" ? item.hit.id : item.hit.screenId;
    const hosts = item.kind === "screen" ? item.hit.boards : item.hit.board ? [item.hit.board] : [];
    // Stay on the current board when it already shows the screen; otherwise
    // follow the first hosting board. A screen placed nowhere still opens in
    // the sidebar tree via selectScreen / the selection screen-follow.
    const targetBoard = hosts.some((h) => h.id === state.currentBoardId)
      ? state.currentBoardId
      : (hosts[0]?.id ?? null);
    if (targetBoard && targetBoard !== state.currentBoardId) await state.selectBoard(targetBoard);

    if (item.kind === "screen") {
      await state.selectScreen(screenId);
    } else {
      useCanvas.getState().revealSelection({ screenId, path: pathToString(item.hit.path) });
    }

    if (!targetBoard) return;
    const frame = useCanvas
      .getState()
      .boards[targetBoard]?.frames.find((f) => f.screen === screenId);
    // After the board actually rendered — Board's own view-restore effect for
    // a fresh board runs first, then this wins.
    if (frame) {
      requestAnimationFrame(() => useCanvas.getState().centerOnFrame(frame.id));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, items.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[active];
      if (item) void go(item);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const step = e.shiftKey ? FILTER_CYCLE.length - 1 : 1;
      setFilter(
        (f) => FILTER_CYCLE[(FILTER_CYCLE.indexOf(f) + step) % FILTER_CYCLE.length] ?? "all",
      );
      setActiveIndex(0);
    }
  };

  const q = results?.query ?? "";
  const total = results ? results.boards.length + results.screens.length + results.textTotal : 0;
  const counts = results
    ? {
        all: total,
        boards: results.boards.length,
        screens: results.screens.length,
        text: results.textTotal,
      }
    : null;

  let flatIndex = -1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        aria-describedby={undefined}
        onKeyDown={onKeyDown}
        className="top-[16%] max-w-[680px] translate-y-0 gap-0 overflow-hidden p-0 [&>[data-slot=dialog-close]]:hidden"
      >
        <DialogTitle className="sr-only">Search boards, screens, and text</DialogTitle>

        <div className="flex h-[52px] items-center gap-3 border-b px-4">
          <Search size={17} className="shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search boards, screens, and text…"
            className="h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            esc
          </kbd>
        </div>

        {counts ? (
          <div className="flex items-center gap-1.5 border-b px-3 py-2">
            {FILTER_CYCLE.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setFilter(f);
                  setActiveIndex(0);
                }}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] capitalize",
                  filter === f
                    ? "bg-foreground font-medium text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {f === "all" ? "All" : f} {counts[f]}
              </button>
            ))}
          </div>
        ) : null}

        <div ref={listRef} className="max-h-[380px] overflow-y-auto pb-1.5">
          {!results ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Type to search board names, screen names, and text inside screens.
            </p>
          ) : items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No matches for “{q}”.
            </p>
          ) : (
            <>
              {groups.boards.length > 0 ? <GroupLabel>Boards</GroupLabel> : null}
              {groups.boards.map((hit) => {
                flatIndex += 1;
                const index = flatIndex;
                return (
                  <ResultRow
                    key={hit.id}
                    index={index}
                    active={index === active}
                    onPick={() => void go({ kind: "board", hit })}
                    onHover={() => setActiveIndex(index)}
                  >
                    <LayoutGrid size={16} className="shrink-0 text-muted-foreground" />
                    <span className="truncate text-[13.5px]">
                      <Highlighted text={hit.name} query={q} />
                    </span>
                    <span className="ml-auto shrink-0 text-[11.5px] text-muted-foreground">
                      {hit.frameCount} frame{hit.frameCount === 1 ? "" : "s"}
                    </span>
                  </ResultRow>
                );
              })}

              {groups.screens.length > 0 ? <GroupLabel>Screens</GroupLabel> : null}
              {groups.screens.map((hit) => {
                flatIndex += 1;
                const index = flatIndex;
                return (
                  <ResultRow
                    key={hit.id}
                    index={index}
                    active={index === active}
                    onPick={() => void go({ kind: "screen", hit })}
                    onHover={() => setActiveIndex(index)}
                  >
                    <FrameIcon size={16} className="shrink-0 text-muted-foreground" />
                    <span className="truncate text-[13.5px]">
                      <Highlighted text={hit.name} query={q} />
                    </span>
                    <span className="ml-auto shrink-0 text-[11.5px] text-muted-foreground">
                      {hit.boards.map((b) => b.name).join(" · ") || "Not on a board"}
                    </span>
                  </ResultRow>
                );
              })}

              {groups.text.length > 0 ? <GroupLabel>Text matches</GroupLabel> : null}
              {groups.text.map((hit) => {
                flatIndex += 1;
                const index = flatIndex;
                return (
                  <ResultRow
                    key={`${hit.screenId}:${hit.path.join(".")}`}
                    index={index}
                    active={index === active}
                    onPick={() => void go({ kind: "text", hit })}
                    onHover={() => setActiveIndex(index)}
                    tall
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px]">
                        “{hit.excerpt.slice(0, hit.matchStart)}
                        <mark className="rounded-[3px] bg-primary/15 px-0.5 font-medium text-primary">
                          {hit.excerpt.slice(hit.matchStart, hit.matchEnd)}
                        </mark>
                        {hit.excerpt.slice(hit.matchEnd)}”
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {hit.board ? `${hit.board.name} › ` : ""}
                        {hit.screenName} › {hit.ref}
                        {hit.nodeId ? ` @${hit.nodeId}` : ""}
                        {hit.prop !== "children" ? ` · ${hit.prop}` : ""}
                      </p>
                    </div>
                  </ResultRow>
                );
              })}

              {results.textTotal > groups.text.length && (filter === "all" || filter === "text") ? (
                <p className="px-4 py-1.5 text-[11.5px] text-muted-foreground">
                  {results.textTotal - groups.text.length} more text match
                  {results.textTotal - groups.text.length === 1 ? "" : "es"} — keep typing to
                  narrow.
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="flex h-10 items-center gap-4 border-t px-4 text-[11px] text-muted-foreground">
          <Hint keys="↑↓">navigate</Hint>
          <Hint keys="↵">jump to match</Hint>
          <Hint keys="tab">switch filter</Hint>
          {results ? (
            <span className="ml-auto">
              {total} match{total === 1 ? "" : "es"}
            </span>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

function ResultRow({
  index,
  active,
  tall,
  onPick,
  onHover,
  children,
}: {
  index: number;
  active: boolean;
  tall?: boolean;
  onPick: () => void;
  onHover: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-result-index={index}
      onClick={onPick}
      onMouseMove={onHover}
      className={cn(
        "mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-3 rounded-md px-2.5 text-left",
        tall ? "py-2" : "h-10",
        active && "bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[3px] bg-primary/15 px-0.5 font-medium text-primary">
        {text.slice(i, i + query.length)}
      </mark>
      {text.slice(i + query.length)}
    </>
  );
}

function Hint({ keys, children }: { keys: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded border bg-muted px-1 py-px text-[10px] font-medium">{keys}</kbd>
      {children}
    </span>
  );
}
