import { TYPESET_SCALE_NAMES } from "@velloo/schema/typeset";
import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The typeset ladder's utilities are theme-generated, so stock tailwind-merge
 * has never heard of them: it would classify `text-h1` as a *color* (the
 * `text-<color>` group) and `leading-h1` / `tracking-h1` as unknown. That
 * misfiling both kept a component default alive next to an author's override
 * (`<Heading className="text-sm">` still carried `text-h1`, and the larger one
 * won) and dropped a size next to a tone (`text-body text-foreground`).
 *
 * Registering the role names in the right groups restores last-wins per group,
 * which every helper relies on for `className` to be an override.
 *
 * Exported as the ONE merge for velloo-owned class strings — codegen's emit and
 * the snapshot runtime use it too, so a typeset class survives the same way in
 * the canvas and in generated code.
 */
export const mergeTailwind = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": TYPESET_SCALE_NAMES.map((role) => `text-${role}`),
      leading: TYPESET_SCALE_NAMES.map((role) => `leading-${role}`),
      tracking: TYPESET_SCALE_NAMES.map((role) => `tracking-${role}`),
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return mergeTailwind(clsx(inputs));
}
