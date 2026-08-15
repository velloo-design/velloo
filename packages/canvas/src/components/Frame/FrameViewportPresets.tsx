import type { Frame as FrameT, ViewportPreset } from "@velloo/schema";
import { Monitor, Smartphone, Tablet } from "lucide-react";

interface FrameViewportPresetsProps {
  frame: FrameT;
  presets: ViewportPreset[];
  onPick: (preset: ViewportPreset) => void;
}

const PRESET_ICON_SIZE = 11;

/**
 * Row of viewport preset chips beneath a frame. Click to snap the frame
 * to that preset's dimensions; the active preset is highlighted.
 */
export function FrameViewportPresets({ frame, presets, onPick }: FrameViewportPresetsProps) {
  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      {presets.map((preset) => {
        const active = preset.w === frame.w && preset.h === frame.h;
        return (
          <button
            key={preset.name}
            type="button"
            onClick={() => onPick(preset)}
            title={`${preset.name}: ${preset.w}×${preset.h}`}
            className={
              "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] " +
              (active
                ? "border-primary bg-primary/10 text-primary"
                : "bg-card text-muted-foreground hover:text-foreground")
            }
          >
            {presetIcon(preset)}
            {preset.name}
          </button>
        );
      })}
    </div>
  );
}

function presetIcon(preset: ViewportPreset) {
  const name = preset.name.toLowerCase();
  if (name.includes("mobile")) return <Smartphone size={PRESET_ICON_SIZE} />;
  if (name.includes("tablet")) return <Tablet size={PRESET_ICON_SIZE} />;
  return <Monitor size={PRESET_ICON_SIZE} />;
}
