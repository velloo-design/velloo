import type { ColorPair, Theme } from "@velloo/schema";
import { useState } from "react";
import { theme as themeApi } from "../api.ts";
import { useCanvas } from "../store.ts";
import { ColorEditor, ColorSwatch } from "./ColorSwatch.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";

interface Slot {
  key: keyof Theme["colors"];
  label: string;
  /** Whether this slot supports a `.foreground` pair. */
  pair: boolean;
}

const SLOTS: Slot[] = [
  { key: "background", label: "Background", pair: false },
  { key: "foreground", label: "Foreground", pair: false },
  { key: "primary", label: "Primary", pair: true },
  { key: "secondary", label: "Secondary", pair: true },
  { key: "muted", label: "Muted", pair: true },
  { key: "accent", label: "Accent", pair: true },
  { key: "destructive", label: "Destructive", pair: true },
  { key: "card", label: "Card", pair: true },
  { key: "popover", label: "Popover", pair: true },
  { key: "border", label: "Border", pair: false },
  { key: "input", label: "Input", pair: false },
  { key: "ring", label: "Ring", pair: false },
];

function defaultOf(value: ColorPair | string | undefined): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.DEFAULT;
  return "";
}

function foregroundOf(value: ColorPair | string | undefined): string | null {
  if (value && typeof value === "object" && value.foreground) return value.foreground;
  return null;
}

/** One editable swatch per colour role the theme defines, pairs with their foreground. */
export function ThemeColorSlots({ theme }: { theme: Theme }) {
  return (
    <div className="flex flex-col gap-3">
      {SLOTS.map((slot) => {
        const v = theme.colors[slot.key];
        const def = defaultOf(v);
        if (!def) return null;
        const fg = foregroundOf(v);
        return (
          <div key={slot.key} className="flex flex-col gap-1.5">
            <ColorSwatch
              label={slot.label}
              tokenPath={
                slot.pair && typeof v === "object"
                  ? `colors.${slot.key}.DEFAULT`
                  : `colors.${slot.key}`
              }
              value={def}
            />
            {slot.pair && fg ? (
              <div className="pl-9">
                <ColorSwatch
                  label={`${slot.label} fg`}
                  tokenPath={`colors.${slot.key}.foreground`}
                  value={fg}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Rebuild the whole palette, light and dark, from one seed colour. */
export function SeedPalette() {
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const themeName = useCanvas((s) => s.themeName);
  const primary = useCanvas((s) => defaultOf(s.theme?.colors.primary));

  const onDerive = async () => {
    if (!seed.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      await themeApi.deriveFromColor(themeName, seed.trim());
      setStatus(`palette derived from ${seed.trim()}`);
    } catch (err) {
      setStatus(`derive failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="theme-seed" className="text-xs text-muted-foreground">
          derive palette from color
        </Label>
        <div className="flex gap-2">
          {/* The wheel a colour role opens: picking a seed is the same gesture. */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="h-8 w-8 rounded-md border shrink-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                style={{ background: seed.trim() || primary || "transparent" }}
                aria-label="Pick the seed colour"
              />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72">
              <ColorEditor currentValue={seed.trim() || primary || "#000000"} onCommit={setSeed} />
            </PopoverContent>
          </Popover>
          <Input
            id="theme-seed"
            type="text"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="#7c3aed or oklch(...)"
            spellCheck={false}
            className="flex-1 text-xs font-mono"
          />
          <Button variant="outline" size="sm" onClick={onDerive} disabled={busy || !seed.trim()}>
            {busy ? "…" : "Apply"}
          </Button>
        </div>
      </div>
      {status ? <div className="text-[10px] text-muted-foreground">{status}</div> : null}
    </div>
  );
}
