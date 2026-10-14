import type { ViewportPreset } from "@velloo/schema";
import { useMemo } from "react";
import { useCanvas } from "./store.ts";

/** Until the design summary arrives — a loaded folder always has at least one. */
const FALLBACK_PRESETS: ViewportPreset[] = [
  { name: "Mobile", w: 390, h: 844 },
  { name: "Tablet", w: 768, h: 1024 },
  { name: "Desktop", w: 1440, h: 900 },
];
const FALLBACK_KEY = JSON.stringify(FALLBACK_PRESETS);

/**
 * The folder's viewport presets, as Settings → Design and an agent's
 * `update_viewport_presets` leave them. Every summary refetch parses a new
 * array, so this subscribes to their content: the result keeps its identity
 * until a preset actually changes, and memoized frames that take it don't
 * re-render on an unrelated refresh.
 */
export function useViewportPresets(): ViewportPreset[] {
  const key = useCanvas((s) => {
    const fromConfig = s.design?.viewportPresets;
    return fromConfig && fromConfig.length > 0 ? JSON.stringify(fromConfig) : FALLBACK_KEY;
  });
  return useMemo(
    () => (key === FALLBACK_KEY ? FALLBACK_PRESETS : (JSON.parse(key) as ViewportPreset[])),
    [key],
  );
}
