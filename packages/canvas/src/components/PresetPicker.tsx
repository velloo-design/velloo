import { useEffect, useState } from "react";
import { theme as themeApi } from "../api.ts";
import { toastError } from "../toast.ts";

interface Props {
  presets: string[];
  activeName: string;
}

interface PresetSummary {
  name: string;
  swatches: {
    background: string;
    primary: string;
    accent: string;
    foreground: string;
  };
}

/**
 * Gallery grid of theme presets. Each card shows three swatches
 * (background, primary, accent) the user can scan visually instead of
 * applying a preset to find out what it looks like. Clicking a card
 * applies the preset; the active preset gets a ring.
 *
 * Falls back to text chips if the summaries endpoint hasn't responded
 * yet (no loading flash for the common case where the request is fast).
 */
export function PresetPicker({ presets, activeName }: Props) {
  const [summaries, setSummaries] = useState<PresetSummary[] | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/theme/preset-summaries")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${res.status}`))))
      .then((body: { presets: PresetSummary[] }) => {
        if (alive) setSummaries(body.presets);
      })
      .catch(() => {
        /* fall back to text chips */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (presets.length === 0) return null;

  const apply = (name: string) => {
    void themeApi.applyPreset(name).catch((err) => toastError(err, "Could not apply preset"));
  };

  if (!summaries) {
    return (
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => apply(p)}
            className={
              "rounded-full border px-2.5 py-1 text-xs transition-colors " +
              (p === activeName
                ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]"
                : "bg-[var(--color-bg)] text-[var(--color-fg)] border-[var(--color-border)] hover:bg-[var(--color-surface)]")
            }
          >
            {p}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {summaries.map((s) => {
        const active = s.name === activeName;
        return (
          <button
            key={s.name}
            type="button"
            onClick={() => apply(s.name)}
            className={
              "group flex flex-col items-stretch gap-1.5 rounded-md border p-2 text-left transition-colors " +
              (active
                ? "border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30"
                : "border-[var(--color-border)] hover:border-[var(--color-accent)]/50")
            }
            title={`${s.name}${active ? " — active" : ""}`}
          >
            <div
              className="flex h-9 w-full overflow-hidden rounded"
              style={{ backgroundColor: s.swatches.background }}
            >
              <div className="flex-1" style={{ backgroundColor: s.swatches.primary }} />
              <div className="flex-1" style={{ backgroundColor: s.swatches.accent }} />
              <div className="flex-1" style={{ backgroundColor: s.swatches.background }} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--color-fg)]">{s.name}</span>
              {active ? (
                <span className="text-[10px] uppercase tracking-wider text-[var(--color-accent)]">
                  active
                </span>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
