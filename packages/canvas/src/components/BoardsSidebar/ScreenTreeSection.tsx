import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import type { ScreenMeta } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { Tree } from "../Tree.tsx";
import { Empty, EmptyDescription } from "../ui/empty.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.tsx";

interface Props {
  screens: ScreenMeta[];
  currentBoardId: string | null;
  currentScreenId: string | null;
}

/**
 * The lower half of the boards sidebar: the node tree of the active screen,
 * with a picker over the screens the active board places.
 */
export function ScreenTreeSection({ screens, currentBoardId, currentScreenId }: Props) {
  const selectScreen = useCanvas((s) => s.selectScreen);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const treeCollapsed = useCanvas((s) => s.treeCollapsed);
  const toggleTreeCollapsed = useCanvas((s) => s.toggleTreeCollapsed);
  const currentScreen = useCanvas((s) =>
    currentScreenId ? (s.screens[currentScreenId] ?? null) : null,
  );
  const snippetFocus = useCanvas((s) => s.snippetFocus);
  const setSnippetFocus = useCanvas((s) => s.setSnippetFocus);
  const focusedScreen = useCanvas((s) =>
    s.snippetFocus ? (s.screens[`snippet:${s.snippetFocus}`] ?? null) : null,
  );
  // Editing a snippet in place scopes everything to its definition, and the
  // tree is the one place you can reach a node the canvas doesn't show.
  const treeScreen = focusedScreen ?? currentScreen;
  const currentBoard = useCanvas((s) =>
    currentBoardId ? (s.boards[currentBoardId] ?? null) : null,
  );

  // Only screens placed on the active board belong in the Tree
  // dropdown — otherwise the picker offers screens unrelated to what's
  // on the canvas. Preserves frame order so the first option matches
  // the canvas' first frame.
  const boardScreens = useMemo<ScreenMeta[]>(() => {
    if (!currentBoard) return [];
    const byId = new Map(screens.map((s) => [s.id, s]));
    const seen = new Set<string>();
    const out: ScreenMeta[] = [];
    for (const f of currentBoard.frames) {
      if (seen.has(f.screen)) continue;
      seen.add(f.screen);
      const meta = byId.get(f.screen);
      if (meta) out.push(meta);
    }
    // A selection can land on a screen this board doesn't place (activity-feed
    // or search navigation) — keep it pickable so the Select never renders a
    // blank value for a real, open screen.
    if (currentScreenId && !seen.has(currentScreenId)) {
      const meta = byId.get(currentScreenId);
      if (meta) out.push(meta);
    }
    return out;
  }, [currentBoard, screens, currentScreenId]);

  return (
    <section className={treeCollapsed ? "shrink-0" : "flex-1 flex flex-col min-h-0"}>
      <div className="px-4 py-2 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground border-b">
        <button
          type="button"
          onClick={toggleTreeCollapsed}
          className="shrink-0 hover:text-foreground transition-colors"
          aria-expanded={!treeCollapsed}
          title={treeCollapsed ? "Expand tree" : "Collapse tree"}
        >
          {treeCollapsed ? (
            <ChevronRight size={12} strokeWidth={2.5} />
          ) : (
            <ChevronDown size={12} strokeWidth={2.5} />
          )}
        </button>
        {snippetFocus !== null ? (
          <>
            <span className="min-w-0 flex-1 truncate text-violet-500">
              {focusedScreen?.name ?? snippetFocus}
            </span>
            <button
              type="button"
              onClick={() => setSnippetFocus(null)}
              className="shrink-0 normal-case tracking-normal hover:text-foreground"
              title="Stop editing this snippet (Esc)"
            >
              Done
            </button>
          </>
        ) : boardScreens.length > 1 ? (
          <Select
            value={currentScreenId ?? ""}
            onValueChange={(id) => {
              if (id) void selectScreen(id);
            }}
          >
            <SelectTrigger
              size="sm"
              className="h-6 w-auto min-w-0 max-w-full overflow-hidden px-2 text-[10px] uppercase tracking-wider"
            >
              <SelectValue className="min-w-0 truncate" />
            </SelectTrigger>
            <SelectContent>
              {boardScreens.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="min-w-0 flex-1 truncate">{currentScreen?.name ?? "No screen"}</span>
        )}
      </div>
      {treeCollapsed ? null : (
        <div
          className={
            "flex-1 overflow-auto scroll-stable py-1 " +
            (cursorMode === "hand" ? "opacity-40 pointer-events-none select-none" : "")
          }
          aria-disabled={cursorMode === "hand"}
        >
          {treeScreen ? (
            <Tree key={treeScreen.id} screen={treeScreen} />
          ) : (
            <Empty className="px-4 py-2">
              <EmptyDescription className="text-xs">
                Pick a screen above to see its tree.
              </EmptyDescription>
            </Empty>
          )}
        </div>
      )}
    </section>
  );
}
