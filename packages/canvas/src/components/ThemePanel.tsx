import type { ColorPair, Theme } from "@velloo/schema";
import { useState } from "react";
import { theme as themeApi } from "../api.ts";
import { useCanvas } from "../store.ts";
import { ColorSwatch } from "./ColorSwatch.tsx";
import { ContrastReport } from "./ContrastReport.tsx";
import { PresetPicker } from "./PresetPicker.tsx";

interface Props {
  theme: Theme;
  presets: string[];
}

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

export function ThemePanel({ theme, presets }: Props) {
  const [vibe, setVibe] = useState("");
  const [seed, setSeed] = useState("");
  const [vibeUseAi, setVibeUseAi] = useState(false);
  const [busy, setBusy] = useState<null | "vibe" | "derive">(null);
  const [status, setStatus] = useState<string | null>(null);
  // Re-fetch contrast whenever the theme changes anywhere.
  const themeVersion = useCanvas((s) => s.themeVersion);

  const onDerive = async () => {
    if (!seed.trim()) return;
    setBusy("derive");
    setStatus(null);
    try {
      await themeApi.deriveFromColor(seed.trim());
      setStatus(`palette derived from ${seed.trim()}`);
    } catch (err) {
      setStatus(`derive failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onMatchVibe = async () => {
    if (!vibe.trim()) return;
    setBusy("vibe");
    setStatus(null);
    try {
      const r = await themeApi.matchVibe(vibe.trim(), vibeUseAi);
      setStatus(`vibe matched: ${r.matched.description} (${r.matched.source})`);
    } catch (err) {
      setStatus(`match_vibe failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">Presets</div>
        <PresetPicker presets={presets} activeName={theme.name} />
      </section>

      <section className="flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
          Generate
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="theme-seed" className="text-xs text-[var(--color-fg-muted)]">
            derive palette from color
          </label>
          <div className="flex gap-2">
            <input
              id="theme-seed"
              type="text"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="#7c3aed or oklch(...)"
              spellCheck={false}
              className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs font-mono"
            />
            <button
              type="button"
              onClick={onDerive}
              disabled={busy !== null || !seed.trim()}
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs disabled:opacity-50"
            >
              {busy === "derive" ? "…" : "Apply"}
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="theme-vibe" className="text-xs text-[var(--color-fg-muted)]">
            match a vibe
          </label>
          <div className="flex gap-2">
            <input
              id="theme-vibe"
              type="text"
              value={vibe}
              onChange={(e) => setVibe(e.target.value)}
              placeholder="playful, corporate, forest…"
              className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs"
            />
            <button
              type="button"
              onClick={onMatchVibe}
              disabled={busy !== null || !vibe.trim()}
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs disabled:opacity-50"
            >
              {busy === "vibe" ? "…" : "Match"}
            </button>
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-[var(--color-fg-muted)]">
            <input
              type="checkbox"
              checked={vibeUseAi}
              onChange={(e) => setVibeUseAi(e.target.checked)}
            />
            use Claude (requires ANTHROPIC_API_KEY)
          </label>
        </div>
        {status ? <div className="text-[10px] text-[var(--color-fg-muted)]">{status}</div> : null}
      </section>

      <section className="flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
          Accessibility
        </div>
        <ContrastReport bumpKey={themeVersion} />
      </section>

      <section className="flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">Colors</div>
        <div className="flex flex-col gap-3">
          {SLOTS.map((slot) => {
            const v = theme.colors[slot.key];
            const def = defaultOf(v);
            if (!def) return null;
            const fg = foregroundOf(v);
            return (
              <div key={slot.key} className="flex flex-col gap-1">
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
      </section>
    </div>
  );
}
