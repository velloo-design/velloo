import type { Theme } from "@velloo/schema";
import { useEffect, useState } from "react";
import { theme as themeApi } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { Field, FieldDescription, FieldLabel } from "../ui/field.tsx";
import { Slider } from "../ui/slider.tsx";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx";
import { pxToRadius, RADIUS_PRESETS, radiusToPx } from "./radius.ts";

const MAX_RADIUS = 24;

/**
 * One control for how round the design is. It writes `radius.md` — the value
 * every framework's corners derive from (`--radius`, MUI's `shape.borderRadius`)
 * — so the specimen's whole corner scale moves together.
 */
export function ShapeStep({ theme }: { theme: Theme }) {
  const themeName = useCanvas((s) => s.themeName);
  const stored = theme.radius.md ?? theme.radius.lg ?? theme.radius.sm;
  const committed = radiusToPx(stored);
  const [px, setPx] = useState(committed ?? 8);

  useEffect(() => {
    if (committed !== null) setPx(committed);
  }, [committed]);

  const commit = (next: number) => {
    setPx(next);
    void themeApi
      .setToken(themeName, "radius.md", pxToRadius(next))
      .catch((err) => toastError(err, "Could not set the corner radius"));
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      <Field>
        <FieldLabel>Corners</FieldLabel>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          className="w-full"
          value={String(px)}
          onValueChange={(v) => {
            if (v !== "") commit(Number(v));
          }}
        >
          {RADIUS_PRESETS.map((preset) => (
            <ToggleGroupItem key={preset.px} value={String(preset.px)} className="flex-1 text-xs">
              {preset.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
      <Field>
        <div className="flex items-baseline justify-between">
          <FieldLabel>Radius</FieldLabel>
          <span className="font-mono text-xs tabular-nums">{px}px</span>
        </div>
        <Slider
          aria-label="Corner radius"
          value={[Math.min(px, MAX_RADIUS)]}
          min={0}
          max={MAX_RADIUS}
          step={1}
          onValueChange={([next]) => setPx(next as number)}
          onValueCommit={([next]) => commit(next as number)}
        />
        <FieldDescription className="text-xs">
          {committed === null && stored !== undefined
            ? `The theme's radius is ${String(stored)}, which this control can't show. Moving it replaces that value.`
            : "Small, medium and large corners all derive from this one value."}
        </FieldDescription>
      </Field>
    </div>
  );
}
