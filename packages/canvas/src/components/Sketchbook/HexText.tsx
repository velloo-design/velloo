import { type ReactNode, useRef, useState } from "react";
import { ColorWheel, HexInput, type Hsv, hexToHsv, hsvToHex } from "../color-picker.tsx";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover.tsx";

const HEX = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

/** How long the pointer may be away from a code and its picker before the picker closes. */
const LEAVE_MS = 250;

/**
 * One hex code in a direction's words: its colour beside it, and on hover the
 * same wheel the node HUD opens, to change it. The new code replaces this one
 * in the words when the picker closes, so a drag is one edit.
 */
function HexCode({ code, onChange }: { code: string; onChange: (next: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(code) ?? { h: 0, s: 0, v: 0 });
  const [hex, setHexState] = useState(code);
  // A close scheduled on mouse-leave runs after later edits; it reads this.
  const latest = useRef(code);
  const setHex = (next: string) => {
    latest.current = next;
    setHexState(next);
  };
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A drag on the wheel may carry the pointer out of the picker; it stays open.
  const dragging = useRef(false);

  const stay = () => {
    if (leave.current) clearTimeout(leave.current);
    leave.current = null;
  };
  const show = () => {
    stay();
    if (open) return;
    setHex(code);
    setHsv(hexToHsv(code) ?? { h: 0, s: 0, v: 0 });
    setOpen(true);
  };
  const close = (next = latest.current) => {
    stay();
    setOpen(false);
    if (next.toLowerCase() !== code.toLowerCase()) onChange(next.toUpperCase());
  };
  const later = () => {
    stay();
    if (dragging.current) return;
    leave.current = setTimeout(() => close(), LEAVE_MS);
  };

  return (
    <Popover open={open} onOpenChange={(o) => (o ? show() : close())}>
      <PopoverAnchor asChild>
        <button
          type="button"
          data-hex={code}
          onMouseEnter={show}
          onMouseLeave={later}
          onFocus={show}
          onClick={show}
          className="inline-flex cursor-pointer items-center gap-1 rounded px-0.5 align-baseline font-mono text-[0.92em] hover:bg-muted"
          aria-label={`Colour ${code}: change it`}
        >
          <span
            aria-hidden
            className="inline-block size-3 shrink-0 translate-y-px rounded-[3px] border border-black/15"
            style={{ background: open ? hex : code }}
          />
          {open ? hex.toUpperCase() : code}
        </button>
      </PopoverAnchor>
      <PopoverContent
        className="flex w-56 flex-col gap-3 p-3"
        onMouseEnter={stay}
        onMouseLeave={later}
        onPointerDown={() => {
          dragging.current = true;
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ColorWheel
          value={hsv}
          onChange={(next) => {
            setHsv(next);
            setHex(hsvToHex(next));
          }}
        />
        <HexInput
          hex={hex}
          onChange={(next) => {
            setHex(next);
            const asHsv = hexToHsv(next);
            if (asHsv) setHsv(asHsv);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Text with each hex code in it shown as a swatch that edits it. */
export function HexText({ text, onChange }: { text: string; onChange: (next: string) => void }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(HEX)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const code = match[0];
    parts.push(
      <HexCode
        key={at}
        code={code}
        onChange={(next) => onChange(text.slice(0, at) + next + text.slice(at + code.length))}
      />,
    );
    last = at + code.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
