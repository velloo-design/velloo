import {
  Eye,
  EyeOff,
  Hand,
  MessageSquareText,
  Minus,
  Moon,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Plus,
  Redo2,
  Search,
  Share2,
  StickyNote,
  Sun,
  Undo2,
} from "lucide-react";
import { redo as redoApi, undo as undoApi } from "../api.ts";
import { type CursorMode, useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { AgentActivityIndicator } from "./ActivityFeed.tsx";
import { LogoLockup } from "./Logo.tsx";
import { SettingsMenu } from "./SettingsMenu.tsx";
import { Button } from "./ui/button.tsx";
import { Separator } from "./ui/separator.tsx";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip.tsx";

function HotkeyTip({
  label,
  hotkey,
  children,
}: {
  label: string;
  hotkey?: string;
  children: React.ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        <span className="flex items-center gap-1.5">
          {label}
          {hotkey ? (
            <kbd className="rounded border border-border/40 bg-background/10 px-1 py-px font-mono text-[10px] opacity-80">
              {hotkey}
            </kbd>
          ) : null}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

export function TopBar() {
  const design = useCanvas((s) => s.design);
  const currentScreenId = useCanvas((s) => s.currentScreenId);
  const view = useCanvas((s) => s.view);
  const libraryItem = useCanvas((s) => s.libraryItem);
  const theme = useCanvas((s) => s.theme);
  const canvasZoom = useCanvas((s) => s.canvasZoom);
  const zoomAtViewportCenter = useCanvas((s) => s.zoomAtViewportCenter);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const setCursorMode = useCanvas((s) => s.setCursorMode);
  const enterAnnotateMode = useCanvas((s) => s.enterAnnotateMode);
  const history = useCanvas((s) => s.history);
  const refreshHistory = useCanvas((s) => s.refreshHistory);
  const designMode = useCanvas((s) => s.designMode);
  const setDesignMode = useCanvas((s) => s.setDesignMode);
  const setPublishOpen = useCanvas((s) => s.setPublishOpen);

  const currentScreen = design?.screens.find((s) => s.id === currentScreenId);
  const isDesignDark = designMode === "dark";
  const hasDarkPalette = Boolean(theme?.colorsDark);

  const toggleDesignDark = () => {
    if (!hasDarkPalette) {
      toastError(
        "This theme has no dark palette. Add `colorsDark` in theme/default.json.",
        "Theme has no dark palette",
      );
      return;
    }
    setDesignMode(isDesignDark ? "light" : "dark");
  };

  const onZoomReset = () => {
    zoomAtViewportCenter({ zoom: 1 });
  };

  const onUndo = () => {
    void undoApi()
      .catch((e) => toastError(e, "Undo failed"))
      .finally(() => refreshHistory());
  };
  const onRedo = () => {
    void redoApi()
      .catch((e) => toastError(e, "Redo failed"))
      .finally(() => refreshHistory());
  };

  const cursorOptions: {
    value: CursorMode;
    icon: React.ReactNode;
    label: string;
    hotkey: string;
  }[] = [
    {
      value: "select",
      icon: <MousePointer2 size={14} strokeWidth={2} />,
      label: "Select",
      hotkey: "V",
    },
    { value: "hand", icon: <Hand size={14} strokeWidth={2} />, label: "Pan canvas", hotkey: "H" },
    {
      value: "note",
      icon: <StickyNote size={14} strokeWidth={2} />,
      label: "Drop a free note",
      hotkey: "T",
    },
    {
      value: "annotate",
      icon: <MessageSquareText size={14} strokeWidth={2} />,
      label: "Annotate a node",
      hotkey: "Y",
    },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <header className="h-11 shrink-0 border-b bg-card flex items-center gap-3 px-4 text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <PaneToggle side="left" />
          <LogoLockup fontSize={15} />
          {view === "library" ? (
            <>
              <span className="text-muted-foreground">/</span>
              <span className="truncate">Library</span>
              {libraryItem ? (
                <>
                  <span className="text-muted-foreground">/</span>
                  <span className="truncate">{libraryItem.id}</span>
                </>
              ) : null}
            </>
          ) : currentScreen ? (
            <>
              <span className="text-muted-foreground">/</span>
              <span className="truncate">{currentScreen.name}</span>
            </>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <AgentActivityIndicator />
          <SearchButton />

          <Separator orientation="vertical" className="mx-1 h-5" />

          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={cursorMode}
            onValueChange={(v) => {
              if (!v) return;
              if (v === "annotate") enterAnnotateMode();
              else setCursorMode(v as CursorMode);
            }}
          >
            {cursorOptions.map((opt) => (
              <HotkeyTip key={opt.value} label={opt.label} hotkey={opt.hotkey}>
                <ToggleGroupItem
                  value={opt.value}
                  aria-label={opt.label}
                  aria-pressed={cursorMode === opt.value}
                  data-state={cursorMode === opt.value ? "on" : "off"}
                  className={
                    cursorMode === opt.value
                      ? "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground"
                      : undefined
                  }
                >
                  {opt.icon}
                </ToggleGroupItem>
              </HotkeyTip>
            ))}
          </ToggleGroup>

          <AnnotationsToggle />

          <div className="flex items-center gap-1 ml-2">
            <HotkeyTip
              label={`Undo${history.undo > 0 ? ` — ${history.undo} step${history.undo === 1 ? "" : "s"}` : ""}`}
              hotkey="⌘Z"
            >
              <Button
                variant="outline"
                size="icon-sm"
                onClick={onUndo}
                disabled={history.undo === 0}
              >
                <Undo2 />
              </Button>
            </HotkeyTip>
            <HotkeyTip
              label={`Redo${history.redo > 0 ? ` — ${history.redo} step${history.redo === 1 ? "" : "s"}` : ""}`}
              hotkey="⌘⇧Z"
            >
              <Button
                variant="outline"
                size="icon-sm"
                onClick={onRedo}
                disabled={history.redo === 0}
              >
                <Redo2 />
              </Button>
            </HotkeyTip>
          </div>

          <Separator orientation="vertical" className="mx-1 h-5" />

          <div className="flex items-center gap-1">
            <HotkeyTip label="Zoom out" hotkey="−">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => zoomAtViewportCenter({ factor: 1 / 1.1 })}
              >
                <Minus />
              </Button>
            </HotkeyTip>
            <HotkeyTip label="Reset zoom" hotkey="0">
              <Button
                variant="ghost"
                size="sm"
                onClick={onZoomReset}
                className="min-w-[3rem] tabular-nums text-muted-foreground"
              >
                {Math.round(canvasZoom * 100)}%
              </Button>
            </HotkeyTip>
            <HotkeyTip label="Zoom in" hotkey="+">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => zoomAtViewportCenter({ factor: 1.1 })}
              >
                <Plus />
              </Button>
            </HotkeyTip>
          </div>

          <Separator orientation="vertical" className="mx-1 h-5" />

          <HotkeyTip
            label={
              isDesignDark
                ? "Set canvas default to light; pinned frames stay pinned"
                : "Set canvas default to dark; pinned frames stay pinned"
            }
          >
            <Button variant="outline" size="sm" onClick={toggleDesignDark}>
              {isDesignDark ? <Sun /> : <Moon />}
              <span>Default</span>
            </Button>
          </HotkeyTip>

          <HotkeyTip label="Publish boards as a share link">
            <Button variant="outline" size="sm" onClick={() => setPublishOpen(true)}>
              <Share2 />
              <span>Publish</span>
            </Button>
          </HotkeyTip>

          <SettingsMenu />

          {view === "boards" ? (
            <>
              <Separator orientation="vertical" className="mx-1 h-5" />
              <PaneToggle side="right" />
            </>
          ) : null}
        </div>
      </header>
    </TooltipProvider>
  );
}

/**
 * Pane toggles sit at the two ends of the bar rather than in the cluster on
 * the right: each one is then on the side it acts on, and the cluster — which
 * is already the busiest part of the chrome — doesn't grow. The icon depicts
 * the pane and dims when it's collapsed, so the bar reads as a layout map.
 */
function PaneToggle({ side }: { side: "left" | "right" }) {
  const collapsed = useCanvas((s) =>
    side === "left" ? s.leftPaneCollapsed : s.rightPaneCollapsed,
  );
  const setCollapsed = useCanvas((s) =>
    side === "left" ? s.setLeftPaneCollapsed : s.setRightPaneCollapsed,
  );
  const name = side === "left" ? "sidebar" : "inspector";
  const label = `${collapsed ? "Expand" : "Collapse"} ${name}`;
  return (
    <HotkeyTip label={label} hotkey={side === "left" ? "[" : "]"}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        aria-pressed={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
        className={collapsed ? "text-muted-foreground/60" : ""}
      >
        {side === "left" ? <PanelLeft /> : <PanelRight />}
      </Button>
    </HotkeyTip>
  );
}

function SearchButton() {
  const setSearchOpen = useCanvas((s) => s.setSearchOpen);
  return (
    <HotkeyTip label="Search boards, screens & text" hotkey="⌘K">
      <Button variant="outline" size="icon-sm" onClick={() => setSearchOpen(true)}>
        <Search />
      </Button>
    </HotkeyTip>
  );
}

function AnnotationsToggle() {
  const visible = useCanvas((s) => s.annotationsVisible);
  const setVisible = useCanvas((s) => s.setAnnotationsVisible);
  return (
    <HotkeyTip label={visible ? "Hide annotations + notes" : "Show annotations + notes"}>
      <Button variant="outline" size="icon-sm" onClick={() => setVisible(!visible)}>
        {visible ? <Eye /> : <EyeOff />}
      </Button>
    </HotkeyTip>
  );
}
