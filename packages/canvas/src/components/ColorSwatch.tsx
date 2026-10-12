import { useEffect, useRef, useState } from "react";
import { theme as themeApi } from "../api.ts";
import { normalizeToOklch, parseTriplet } from "../color.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { ColorWheel, type Hsv, hexToHsv, hsvToHex } from "./color-picker.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";

interface FieldProps {
  /** Unique within the page — it ties the label to the text field. */
  id: string;
  label: string;
  /** Any CSS colour; an empty string shows `fallback` in the swatch and wheel. */
  value: string;
  onChange: (next: string) => void;
  /** What the swatch and the wheel start from while `value` is empty. */
  fallback?: string | undefined;
  placeholder?: string | undefined;
  /** Shown on hover of the swatch — the token it edits, when it edits one. */
  title?: string | undefined;
  /** After the text field, on the same line — an action that goes with the colour. */
  children?: React.ReactNode;
}

/**
 * A colour as you edit one anywhere in the canvas: a swatch, the value as
 * text, and the wheel — the same wheel the node HUD opens. The wheel comes up
 * on a click of the swatch and on focus of the text field alike, because
 * someone who tabbed or clicked into the value is choosing a colour too; it
 * sits beside the field without taking the caret, so typing still works.
 */
export function ColorField({
  id,
  label,
  value,
  onChange,
  fallback,
  placeholder,
  title,
  children,
}: FieldProps) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = value.trim() || fallback || "";

  return (
    <div className="flex items-end gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="h-7 w-7 rounded-md border shrink-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            style={{ background: shown || "transparent" }}
            title={title}
            aria-label={`Edit ${label}`}
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-72"
          onOpenAutoFocus={(e) => {
            if (document.activeElement === inputRef.current) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (e.target === inputRef.current) e.preventDefault();
          }}
        >
          <ColorEditor currentValue={shown || "#000000"} onCommit={onChange} />
        </PopoverContent>
      </Popover>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <Label htmlFor={id} className="text-xs text-muted-foreground truncate">
          {label}
        </Label>
        <Input
          ref={inputRef}
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          spellCheck={false}
          className="text-xs font-mono"
        />
      </div>
      {children}
    </div>
  );
}

interface Props {
  label: string;
  tokenPath: string;
  value: string;
  /**
   * Replaces the single-token write — for a value that cannot be saved alone,
   * such as one half of a dark pair that does not exist yet.
   */
  write?: ((value: string) => Promise<unknown>) | undefined;
  children?: React.ReactNode;
}

const DEBOUNCE_MS = 250;

/**
 * A theme colour token: a {@link ColorField} whose edits are written to the
 * theme, debounced. Everything is converted via culori; we always store OKLCH
 * on disk so the theme JSON stays in one canonical form.
 */
export function ColorSwatch({ label, tokenPath, value, write, children }: Props) {
  const [draft, setDraft] = useState(value);
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
      const valueToSend = normalizeToOklch(next) ?? next;
      void (
        write ? write(valueToSend) : themeApi.setToken(themeName, tokenPath, valueToSend)
      ).catch((err) => toastError(err, "Could not set color token"));
    }, DEBOUNCE_MS);
  };

  return (
    <ColorField
      id={`token-${tokenPath}`}
      label={label}
      value={draft}
      onChange={commit}
      title={`${tokenPath} — click to edit`}
    >
      {children}
    </ColorField>
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

  // A value typed into the field beside the wheel arrives as a new
  // `currentValue`. The wheel's own commits come back the same way, but as the
  // OKLCH it already holds, so they are not mistaken for an outside edit.
  const held = useRef(initial.oklch);
  useEffect(() => {
    if (currentValue === held.current) return;
    const trip = parseTriplet(currentValue);
    if (!trip || trip.oklch === held.current) return;
    held.current = trip.oklch;
    setHex(trip.hex);
    setOklch(trip.oklch);
    setHsl(trip.hsl);
    const asHsv = hexToHsv(trip.hex);
    if (asHsv) setHsv(asHsv);
  }, [currentValue]);

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
    held.current = trip.oklch;
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
