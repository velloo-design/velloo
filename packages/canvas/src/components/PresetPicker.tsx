import { theme as themeApi } from "../api.ts";

interface Props {
  presets: string[];
  activeName: string;
}

export function PresetPicker({ presets, activeName }: Props) {
  if (presets.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {presets.map((p) => {
        const active = p === activeName;
        return (
          <button
            key={p}
            type="button"
            onClick={() => {
              void themeApi.applyPreset(p);
            }}
            className={
              "rounded-full border px-2.5 py-1 text-xs transition-colors " +
              (active
                ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]"
                : "bg-[var(--color-bg)] text-[var(--color-fg)] border-[var(--color-border)] hover:bg-[var(--color-surface)]")
            }
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}
