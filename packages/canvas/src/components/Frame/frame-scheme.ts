import type { FrameScheme } from "@velloo/schema";

export interface FrameSchemeOption {
  /** `null` clears the pin and hands the frame back to the canvas default. */
  value: FrameScheme | null;
  label: string;
  ariaLabel: string;
  current: boolean;
}

/**
 * Three explicit states: follow the canvas default, pinned light, or pinned
 * dark. Kept free of JSX so the published viewer — which has no Radix menu to
 * render the canvas component with — can share the wording and the "exactly
 * one is current" rule rather than growing its own vocabulary.
 */
export function frameSchemeOptions(
  frameLabel: string,
  canvasDefault: FrameScheme,
  scheme?: FrameScheme,
): FrameSchemeOption[] {
  const current = scheme ?? null;
  return [
    {
      value: null,
      label: `Follow canvas (${canvasDefault})`,
      ariaLabel: `Follow canvas default for ${frameLabel} (currently ${canvasDefault})`,
      current: current === null,
    },
    {
      value: "light",
      label: "Pin to light",
      ariaLabel: `Pin ${frameLabel} to light mode`,
      current: current === "light",
    },
    {
      value: "dark",
      label: "Pin to dark",
      ariaLabel: `Pin ${frameLabel} to dark mode`,
      current: current === "dark",
    },
  ];
}
