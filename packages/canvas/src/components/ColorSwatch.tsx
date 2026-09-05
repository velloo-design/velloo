import { useEffect, useRef, useState } from "react";
import { theme as themeApi } from "../api.ts";
import { normalizeToOklch, parseTriplet } from "../color.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { ColorWheel, type Hsv, hexToHsv, hsvToHex } from "./color-picker.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";

interface Props {
  label: string;
  tokenPath: string;
  value: string;
}

const DEBOUNCE_MS = 250;

/**
 * Click the swatch to open the colour wheel plus synced HEX / OKLCH / HSL
 * fields — the same wheel the node HUD opens, so picking a colour is one
 * gesture wherever you do it. Everything is converted via culori; we always
 * store OKLCH on disk so the theme JSON stays in one canonical form.
 */
export function ColorSwatch({ label, tokenPath, value }: Props) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const themeName = useCanvas((s) => s.themeName);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const commit = (next: string) => {
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const oklch = normalizeToOklch(next);
      const valueToSend = oklch ?? next;
      void themeApi
        .setToken(themeName, tokenPath, valueToSend)
        .catch((err) => toastError(err, "Could not set color token"));
    }, DEBOUNCE_MS);
  };

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="h-7 w-7 rounded-md border shrink-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            style={{ background: draft }}
            title={`${tokenPath} — click to edit`}
            aria-label={`Edit ${label}`}
          />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72">
          <ColorEditor currentValue={draft} onCommit={commit} />
        </PopoverContent>
      </Popover>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <Label htmlFor={`token-${tokenPath}`} className="text-xs text-muted-foreground truncate">
          {label}
        </Label>
        <Input
          id={`token-${tokenPath}`}
          type="text"
          value={draft}
          onChange={(e) => commit(e.target.value)}
          spellCheck={false}
          className="text-xs font-mono"
        />
      </div>
    </div>
  );
}

/**
 * The wheel, plus the three text forms the theme actually stores in.
 *
 * The native `<input type="color">` this replaced opened the OS picker — a
 * different UI on every platform, none of them the one the HUD uses. The wheel
 * is the same component the node's colour field opens, so picking a colour
 * feels like one thing wherever you do it. HEX / OKLCH / HSL stay because a
 * theme token is a value someone pastes in and reads back, not only one they
 * point at.
 */
function ColorEditor({
  currentValue,
  onCommit,
}: {
  currentValue: string;
  onCommit: (next: string) => void;
}) {
  const initial = parseTriplet(currentValue) ?? {
    hex: "#000000",
    oklch: "oklch(0 0 0)",
    hsl: "hsl(0 0% 0%)",
  };
  const [hex, setHex] = useState(initial.hex);
  const [oklch, setOklch] = useState(initial.oklch);
  const [hsl, setHsl] = useState(initial.hsl);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(initial.hex) ?? { h: 0, s: 0, v: 0 });

  const sync = (next: string, source: "hex" | "oklch" | "hsl" | "wheel") => {
    const trip = parseTriplet(next);
    if (!trip) {
      if (source === "hex") setHex(next);
      if (source === "oklch") setOklch(next);
      if (source === "hsl") setHsl(next);
      return;
    }
    setHex(trip.hex);
    setOklch(trip.oklch);
    setHsl(trip.hsl);
    // Re-deriving HSV from the wheel's own output would fight the drag: the
    // round trip through hex quantises, and the hue of a grey is undefined.
    if (source !== "wheel") {
      const asHsv = hexToHsv(trip.hex);
      if (asHsv) setHsv(asHsv);
    }
    onCommit(trip.oklch);
  };

  return (
    <div className="flex flex-col gap-3">
      <ColorWheel
        value={hsv}
        onChange={(next) => {
          setHsv(next);
          sync(hsvToHex(next), "wheel");
        }}
      />
      <ColorTextField label="HEX" value={hex} onChange={(v) => sync(v, "hex")} />
      <ColorTextField label="OKLCH" value={oklch} onChange={(v) => sync(v, "oklch")} />
      <ColorTextField label="HSL" value={hsl} onChange={(v) => sync(v, "hsl")} />
    </div>
  );
}

function ColorTextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `velloo-color-${label.toLowerCase()}`;
  return (
    <div className="flex items-center gap-2 text-xs">
      <label htmlFor={id} className="w-12 text-muted-foreground uppercase tracking-wider">
        {label}
      </label>
      <Input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="flex-1 font-mono text-xs"
      />
    </div>
  );
}
