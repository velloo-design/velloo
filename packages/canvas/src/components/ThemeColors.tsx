import { type ColorPair, resolveColors, type Theme } from "@velloo/schema";
import { useState } from "react";
import { theme as themeApi } from "../api.ts";
import { useCanvas } from "../store.ts";
import { ColorField, ColorSwatch } from "./ColorSwatch.tsx";
import { Button } from "./ui/button.tsx";

type ColorSlotKey = keyof Theme["colors"];

interface Slot {
  key: ColorSlotKey;
  label: string;
  /** Whether this slot supports a `.foreground` pair. */
  pair: boolean;
}

export const COLOR_SLOTS: readonly Slot[] = [
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

interface SlotsProps {
  theme: Theme;
  /** Which palette to edit. Dark edits `colorsDark`, shown over the light values it inherits. */
  scheme?: "light" | "dark";
  /** Limit the list to these slots, in the list's own order. */
  only?: ReadonlySet<string> | undefined;
}

/** One editable swatch per colour role the theme defines, pairs with their foreground. */
export function ThemeColorSlots({ theme, scheme = "light", only }: SlotsProps) {
  const themeName = useCanvas((s) => s.themeName);
  const dark = scheme === "dark";
  const colors = resolveColors(theme, dark);
  const root = dark ? "colorsDark" : "colors";

  return (
    <div className="flex flex-col gap-3">
      {COLOR_SLOTS.filter((slot) => !only || only.has(slot.key)).map((slot) => {
        const v = colors[slot.key];
        const def = defaultOf(v);
        if (!def) return null;
        const fg = foregroundOf(v);
        const isPair = slot.pair && typeof v === "object";
        // A dark pair that does not exist yet cannot be written one half at a
        // time — `{ foreground }` alone is not a pair. The half being edited
        // goes in with the other as it currently resolves.
        const pairMissing = dark && isPair && typeof theme.colorsDark?.[slot.key] !== "object";
        const writePair = (half: "DEFAULT" | "foreground") =>
          pairMissing
            ? (value: string) =>
                themeApi.setTokens(themeName, [
                  {
                    path: `${root}.${slot.key}.DEFAULT`,
                    value: half === "DEFAULT" ? value : def,
                  },
                  ...(half === "foreground" || fg
                    ? [
                        {
                          path: `${root}.${slot.key}.foreground`,
                          value: half === "foreground" ? value : (fg as string),
                        },
                      ]
                    : []),
                ])
            : undefined;
        return (
          <div key={slot.key} className="flex flex-col gap-1.5">
            <ColorSwatch
              label={slot.label}
              tokenPath={isPair ? `${root}.${slot.key}.DEFAULT` : `${root}.${slot.key}`}
              value={def}
              write={writePair("DEFAULT")}
            />
            {isPair && fg ? (
              <div className="pl-9">
                <ColorSwatch
                  label={`${slot.label} fg`}
                  tokenPath={`${root}.${slot.key}.foreground`}
                  value={fg}
                  write={writePair("foreground")}
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
    <div className="flex flex-col gap-2">
      <ColorField
        id="theme-seed"
        label="derive palette from color"
        value={seed}
        onChange={setSeed}
        fallback={primary}
        placeholder="#7c3aed or oklch(...)"
      >
        <Button variant="outline" size="sm" onClick={onDerive} disabled={busy || !seed.trim()}>
          {busy ? "…" : "Apply"}
        </Button>
      </ColorField>
      {status ? <div className="text-[10px] text-muted-foreground">{status}</div> : null}
    </div>
  );
}
