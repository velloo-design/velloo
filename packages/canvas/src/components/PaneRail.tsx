import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "./ui/button.tsx";

/** A tab of the collapsed pane, offered on the rail as a one-click way back in. */
interface RailAction {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  /**
   * Badge the button. The title spells out what the badge is reporting — a
   * bare dot on an icon is a puzzle, not a notification.
   */
  dot?: { title: string };
  onClick: () => void;
}

interface RailProps {
  side: "left" | "right";
  /** Accessible name for the expand button; the hotkey rides in its tooltip. */
  expandLabel: string;
  hotkey?: string;
  onExpand: () => void;
  actions?: RailAction[];
}

/** Hotkeys belong in the tooltip, not in the name a screen reader announces. */
function titleWith(label: string, hotkey?: string): string {
  return hotkey ? `${label} — ${hotkey}` : label;
}

/**
 * The contents of a collapsed side pane: a narrow rail that keeps the pane
 * discoverable and lets its tabs expand straight into the one you want.
 * Rendered *instead* of the pane's content, deliberately outside whatever
 * disabled/dimmed treatment that content carries — expanding is chrome, not a
 * design edit, so it stays live even while the daemon is unreachable.
 */
export function CollapsedPaneRail({
  side,
  expandLabel,
  hotkey,
  onExpand,
  actions = [],
}: RailProps) {
  return (
    <div className="flex h-full w-full flex-col items-center gap-1 py-2">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onExpand}
        title={titleWith(expandLabel, hotkey)}
        aria-label={expandLabel}
        aria-expanded={false}
      >
        {side === "left" ? <PanelLeftOpen /> : <PanelRightOpen />}
      </Button>
      {actions.length > 0 ? <div className="my-1 h-px w-4 shrink-0 bg-border" /> : null}
      {actions.map((a) => (
        <Button
          key={a.label}
          variant="ghost"
          size="icon-sm"
          onClick={a.onClick}
          title={a.dot ? `${a.label} — ${a.dot.title}` : a.label}
          aria-label={a.label}
          className={`relative ${a.active ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
        >
          {a.icon}
          {a.dot ? (
            <span
              data-rail-dot={a.label}
              className="absolute right-1 top-1 size-1.5 rounded-full bg-primary"
            />
          ) : null}
        </Button>
      ))}
    </div>
  );
}

interface CollapseButtonProps {
  side: "left" | "right";
  label: string;
  hotkey?: string;
  onCollapse: () => void;
}

/** The collapse affordance in an expanded pane's header, mirroring the rail. */
export function PaneCollapseButton({ side, label, hotkey, onCollapse }: CollapseButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onCollapse}
      title={titleWith(label, hotkey)}
      aria-label={label}
      aria-expanded={true}
      className="shrink-0 text-muted-foreground"
    >
      {side === "left" ? <PanelLeftClose /> : <PanelRightClose />}
    </Button>
  );
}
