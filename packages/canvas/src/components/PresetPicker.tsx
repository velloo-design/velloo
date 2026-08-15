import { useEffect, useState } from "react";
import { theme as themeApi } from "../api.ts";
import { toastError } from "../toast.ts";
import { Button } from "./ui/button.tsx";

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
          <Button
            key={p}
            variant={p === activeName ? "default" : "outline"}
            size="xs"
            onClick={() => apply(p)}
            className="rounded-full"
          >
            {p}
          </Button>
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
              "group flex flex-col items-stretch gap-1.5 rounded-md border p-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background " +
              (active
                ? "border-primary ring-2 ring-primary/30"
                : "border-border hover:border-primary/50")
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
              <span className="text-xs font-medium">{s.name}</span>
              {active ? (
                <span className="text-[10px] uppercase tracking-wider text-primary">active</span>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
