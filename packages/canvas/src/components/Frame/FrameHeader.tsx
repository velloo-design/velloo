import type { FrameScheme, ViewportPreset } from "@velloo/schema";
import {
  Copy,
  Download,
  GripVertical,
  Library as LibraryIcon,
  Link2,
  Maximize2,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import { FrameSchemeMenu } from "./FrameSchemeMenu.tsx";

interface FrameHeaderProps {
  label: string;
  w: number;
  h: number;
  sharedCount: number;
  /**
   * The library id this frame's screen pins. When unset we
   * skip rendering the badge — a single-library folder doesn't need
   * the extra chrome.
   */
  library?: string | null;
  /** Viewport presets offered by the "new frame of this screen" menu. */
  presets: ViewportPreset[];
  /** Persisted frame pin; absent means follow canvasDefault. */
  scheme?: FrameScheme;
  canvasDefault: FrameScheme;
  onPointerDownGrip: (e: React.PointerEvent<HTMLDivElement>) => void;
  onRemove: () => void;
  /** Open the export dialog for this frame (PNG / PDF / standalone HTML). */
  onExport: () => void;
  /** Commit a new size from the header's inline w/h inputs. */
  onResize: (next: { w?: number; h?: number }) => void;
  /** Open the full-screen preview modal for this frame's screen. */
  onPreview: () => void;
  /** Place a sibling frame of the same screen at the given size. */
  onAddSibling: (size: { w: number; h: number }) => void;
  onSchemeChange: (scheme: FrameScheme | null) => void;
}

const MIN_SIZE = 120;
const MAX_SIZE = 4096;

function clamp(n: number): number {
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(n)));
}

/**
 * Top row of a frame: drag grip, label + editable size inputs,
 * shared-screen badge, and the remove button (visible on hover).
 *
 * The size readout is a pair of `<input type="number">` so power users
 * can type an exact size or press ↑/↓ to nudge the frame by 1px (or
 * step=10 with Shift). Commits on Enter or blur — typing doesn't
 * roundtrip to the server every keystroke.
 */
export function FrameHeader({
  label,
  w,
  h,
  sharedCount,
  library,
  presets,
  scheme,
  canvasDefault,
  onPointerDownGrip,
  onRemove,
  onExport,
  onResize,
  onPreview,
  onAddSibling,
  onSchemeChange,
}: FrameHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-1 min-w-0">
        <div
          onPointerDown={onPointerDownGrip}
          className="shrink-0 h-4 w-4 grid place-items-center rounded cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground hover:bg-card"
          title="Drag to move"
          role="presentation"
        >
          <GripVertical size={12} strokeWidth={2} />
        </div>
        <span className="font-medium truncate">{label}</span>
        <span className="inline-flex items-center gap-0.5 opacity-60 tabular-nums">
          <SizeInput
            value={w}
            ariaLabel="frame width"
            onCommit={(v) => onResize({ w: clamp(v) })}
          />
          <span className="opacity-60">×</span>
          <SizeInput
            value={h}
            ariaLabel="frame height"
            onCommit={(v) => onResize({ h: clamp(v) })}
          />
        </span>
        {library ? (
          <span
            className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] bg-muted text-muted-foreground"
            title={`This screen renders against library "${library}".`}
          >
            <LibraryIcon size={10} strokeWidth={2} />
            {library}
          </span>
        ) : null}
        {sharedCount > 1 ? (
          <span
            className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] bg-primary/10 text-primary"
            title={`${sharedCount} frames share this screen — edits sync across all of them.`}
          >
            <Link2 size={10} />
            {sharedCount}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity h-4 w-5 grid place-items-center rounded hover:bg-card text-muted-foreground hover:text-foreground"
              title="Frame actions"
            >
              <MoreHorizontal size={12} />
            </button>
          </DropdownMenuTrigger>
          {/* Radix portals this to document.body — outside the board's
              pan/zoom transform, so the menu always renders at chrome size. */}
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onPreview}>
              <Maximize2 />
              Full-screen preview
            </DropdownMenuItem>
            <FrameSchemeMenu
              frameLabel={label}
              scheme={scheme}
              canvasDefault={canvasDefault}
              onChange={onSchemeChange}
            />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Plus />
                New frame of this screen
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {presets.map((p) => (
                  <DropdownMenuItem key={p.name} onSelect={() => onAddSibling({ w: p.w, h: p.h })}>
                    {p.name}
                    <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">
                      {p.w}×{p.h}
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onSelect={() => onAddSibling({ w, h })}>
                  <Copy />
                  Duplicate at current size
                  <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">
                    {w}×{h}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={onExport}>
              <Download />
              Export…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRemove}>
              <Trash2 />
              Remove frame
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

interface SizeInputProps {
  value: number;
  ariaLabel: string;
  onCommit: (next: number) => void;
}

/**
 * Inline numeric input wired to commit on blur or Enter. Tracks local
 * draft state so typing doesn't fight the prop value mid-edit. Esc
 * cancels back to the current frame size; ↑/↓ uses the browser's
 * step=1 default (Shift+↑/↓ steps by 10 via the size attribute).
 */
function SizeInput({ value, ariaLabel, onCommit }: SizeInputProps) {
  const [draft, setDraft] = useState<string>(String(value));
  // Keep draft in sync when the frame is resized via drag-handle.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const next = Number(draft);
    if (!Number.isFinite(next)) {
      setDraft(String(value));
      return;
    }
    if (next === value) return;
    onCommit(next);
  };

  return (
    <input
      type="number"
      value={draft}
      min={MIN_SIZE}
      max={MAX_SIZE}
      step={1}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setDraft(String(value));
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="w-10 bg-transparent text-right tabular-nums outline-none hover:bg-card focus:bg-card rounded-sm px-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
    />
  );
}
