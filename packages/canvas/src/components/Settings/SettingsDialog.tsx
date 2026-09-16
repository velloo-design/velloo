import { Check, LayoutGrid, Monitor, PencilRuler, SlidersHorizontal } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import type { SettingsScope } from "../../store/modes.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { Loading } from "../Loading.tsx";
import { Button } from "../ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.tsx";
import { BoardPane } from "./BoardPane.tsx";
import { CanvasPane } from "./CanvasPane.tsx";
import { DesignPane } from "./DesignPane.tsx";

/**
 * The settings dialog — three scopes behind one left rail:
 *
 *   Design → its `config.json`, written through config mutations
 *   Board  → one board's file, written through `update_board`
 *   Canvas → this browser's localStorage, written nowhere else
 *
 * The rail is the scope switcher *and* the explanation of where each setting
 * lives: the whole point is that a user can tell, at a glance, which of these
 * their teammates will see. Account and credits stay in the top-bar
 * menu — they belong to the person, not the design.
 */

const SCOPES: { id: SettingsScope; label: string; icon: typeof PencilRuler }[] = [
  { id: "design", label: "Design", icon: PencilRuler },
  { id: "board", label: "Board", icon: LayoutGrid },
  { id: "canvas", label: "Canvas", icon: SlidersHorizontal },
];

const HEADINGS: Record<SettingsScope, { title: string; description: string }> = {
  design: {
    title: "Design",
    description:
      "Saved to the design's config.json — visible to your agent, and committed with your repo when the design lives in it.",
  },
  board: {
    title: "Board",
    description: "Applies to one board — its own file under boards/, committed with your repo.",
  },
  canvas: {
    title: "Canvas",
    description:
      "How the editor behaves for you. Kept in this browser — never written to the folder, never shared.",
  },
};

export function SettingsDialog() {
  const scope = useCanvas((s) => s.settingsScope);
  const setScope = useCanvas((s) => s.setSettingsScope);
  const cfg = useCanvas((s) => s.folderConfig);
  const loadFolderConfig = useCanvas((s) => s.loadFolderConfig);
  const currentBoardId = useCanvas((s) => s.currentBoardId);
  const boardName = useCanvas(
    (s) => s.design?.boards.find((b) => b.id === s.currentBoardId)?.name ?? null,
  );

  // Config is loaded on open rather than at boot — nothing outside this
  // dialog reads it, and an open dialog stays fresh via `config-changed`.
  useEffect(() => {
    if (scope !== null) {
      void loadFolderConfig().catch((err) => toastError(err, "Could not load design settings"));
    }
  }, [scope, loadFolderConfig]);

  const heading = scope ? HEADINGS[scope] : HEADINGS.design;

  return (
    <Dialog open={scope !== null} onOpenChange={(open) => !open && setScope(null)}>
      <DialogContent
        className={cn(
          "flex h-[min(800px,85vh)] w-[920px] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0",
          "sm:max-w-[920px]",
        )}
      >
        <nav className="flex w-[216px] shrink-0 flex-col border-r border-border bg-muted/40 p-3">
          <div className="px-2 pb-2 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Settings
          </div>
          {SCOPES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setScope(id)}
              className={cn(
                "mt-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] first:mt-0",
                scope === id
                  ? "bg-background font-medium text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
              {id === "board" && boardName ? (
                <span className="ml-auto max-w-[86px] truncate text-[10.5px] font-normal text-muted-foreground">
                  {boardName}
                </span>
              ) : null}
            </button>
          ))}
          {cfg ? (
            <div className="mt-auto rounded-md border border-dashed border-border px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Design folder
              </div>
              <div
                className="mt-1 break-all font-mono text-[10.5px] leading-tight text-foreground/80"
                title={cfg.root}
              >
                {cfg.root}
              </div>
            </div>
          ) : null}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <DialogHeader className="gap-0 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle className="text-[15px] font-semibold leading-tight">
              {heading.title}
            </DialogTitle>
            <DialogDescription className="mt-1 text-[11.5px]">
              {heading.description}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 pb-6 pt-4">
            {scope === "canvas" ? (
              <CanvasPane />
            ) : cfg === null ? (
              <Loading
                size={24}
                label="Loading settings…"
                className="flex-col pt-12 text-[13px] text-muted-foreground"
              />
            ) : scope === "board" ? (
              <BoardPane cfg={cfg} key={currentBoardId ?? ""} />
            ) : (
              <DesignPane cfg={cfg} />
            )}
          </div>

          <div className="flex h-12 shrink-0 items-center gap-2 border-t border-border bg-muted/30 px-6">
            {scope === "canvas" ? (
              <>
                <Monitor className="size-3.5 text-muted-foreground" />
                <span className="text-[11.5px] text-muted-foreground">This browser only.</span>
              </>
            ) : (
              <>
                <Check className="size-3.5 text-muted-foreground" />
                <span className="text-[11.5px] text-muted-foreground">
                  Changes save as you make them.
                </span>
              </>
            )}
            <Button size="sm" className="ml-auto h-8 text-[13px]" onClick={() => setScope(null)}>
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
