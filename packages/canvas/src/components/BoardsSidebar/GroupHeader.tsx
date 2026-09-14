import {
  Check,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Palette,
  Pencil,
  Trash2,
} from "lucide-react";
import type { DragEvent } from "react";
import type { BoardGroupMeta } from "../../api.ts";
import { ICON_MENU_WIDTH } from "../../lib/utils.ts";
import { Button } from "../ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";

/** Colors offered in a group's recolor menu — the server's palette, named. */
const GROUP_COLORS = [
  { value: "#8b5cf6", label: "Violet" },
  { value: "#0ea5e9", label: "Sky" },
  { value: "#f59e0b", label: "Amber" },
  { value: "#f43f5e", label: "Rose" },
  { value: "#10b981", label: "Emerald" },
  { value: "#6366f1", label: "Indigo" },
  { value: "#ec4899", label: "Pink" },
  { value: "#84cc16", label: "Lime" },
];

interface GroupHeaderProps {
  group: BoardGroupMeta;
  count: number;
  collapsed: boolean;
  /** True while a dragged board would land in this group. */
  dropTarget: boolean;
  disabled: boolean;
  onToggle: () => void;
  onDragOver: (e: DragEvent<HTMLLIElement>) => void;
  onRename: () => void;
  onRecolor: (color: string) => void;
  onDelete: () => void;
}

/**
 * A sidebar group header: color chip, name, board count, and the group's own
 * menu. Doubles as a drop target — dragging a board onto it files the board.
 */
export function GroupHeader({
  group,
  count,
  collapsed,
  dropTarget,
  disabled,
  onToggle,
  onDragOver,
  onRename,
  onRecolor,
  onDelete,
}: GroupHeaderProps) {
  return (
    <li
      onDragOver={onDragOver}
      className={`group/gr relative flex items-center rounded-md pr-7 ${dropTarget ? "bg-accent" : ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-muted"
      >
        {collapsed ? (
          <ChevronRight size={12} strokeWidth={2.5} className="shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown size={12} strokeWidth={2.5} className="shrink-0 text-muted-foreground" />
        )}
        <span
          className="size-2.5 shrink-0 rounded-[3px]"
          style={{ backgroundColor: group.color ?? "var(--muted-foreground)" }}
        />
        <span className="truncate text-xs font-semibold">{group.name}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{count}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            title="Group menu"
            className="absolute right-1 top-1.5 opacity-0 group-hover/gr:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={ICON_MENU_WIDTH}>
          <DropdownMenuItem disabled={disabled} onSelect={onRename}>
            <Pencil />
            Rename group
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={disabled}>
              <Palette />
              Color
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {GROUP_COLORS.map(({ value, label }) => (
                <DropdownMenuItem key={value} onSelect={() => onRecolor(value)}>
                  <span className="size-3 rounded-[3px]" style={{ backgroundColor: value }} />
                  {label}
                  {group.color === value ? <Check className="ml-auto" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem variant="destructive" disabled={disabled} onSelect={onDelete}>
            <Trash2 />
            Delete group
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
