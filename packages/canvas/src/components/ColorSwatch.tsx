import { useEffect, useRef, useState } from "react";
import { theme as themeApi } from "../api.ts";
import { normalizeToOklch, parseTriplet } from "../color.ts";
import { toastError } from "../toast.ts";
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
 * Click the swatch to open a small color editor with a native picker
 * plus synced HEX / OKLCH / HSL fields. Everything is converted via
 * culori; we always store OKLCH on disk so the theme JSON stays in one
 * canonical form.
 */
export function ColorSwatch({ label, tokenPath, value }: Props) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        .setToken(tokenPath, valueToSend)
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

  const sync = (next: string, source: "hex" | "oklch" | "hsl") => {
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
    onCommit(trip.oklch);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label="Color picker"
          value={parseTriplet(hex)?.hex ?? "#000000"}
          onChange={(e) => sync(e.target.value, "hex")}
          className="h-9 w-9 rounded-md border border-input cursor-pointer"
        />
        <div
          className="flex-1 h-9 rounded-md border"
          style={{ background: oklch || hex }}
          title="Preview"
        />
      </div>
      <ColorField label="HEX" value={hex} onChange={(v) => sync(v, "hex")} />
      <ColorField label="OKLCH" value={oklch} onChange={(v) => sync(v, "oklch")} />
      <ColorField label="HSL" value={hsl} onChange={(v) => sync(v, "hsl")} />
    </div>
  );
}

function ColorField({
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
