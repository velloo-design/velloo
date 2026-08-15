// Velloo-owned gradient background helper. Renders a div with a
// pre-baked gradient class wired to theme tokens, so designs can drop a
// branded hero background without remembering Tailwind arbitrary-value
// syntax. Composes via className for fine-tuning.
import type * as React from "react";
import { cn } from "../../lib/utils.ts";

export interface GradientProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Preset gradient name. Each maps to a theme-token-aware Tailwind
   * gradient string so they all theme-flip correctly.
   *
   * - `primary`: subtle primary wash for hero sections.
   * - `accent`: louder accent splash for CTAs / banners.
   * - `radial`: radial primary glow (light center, fade out).
   * - `mesh`: layered 3-stop gradient for marketing splashes.
   * - `dusk` / `dawn`: warm/cool atmosphere gradients.
   */
  preset?: "primary" | "accent" | "radial" | "mesh" | "dusk" | "dawn";
  /**
   * Gradient direction for linear presets (`primary`, `accent`, `dusk`,
   * `dawn`). Tailwind shorthand: `t` (to top), `b`, `l`, `r`, `tl`, `tr`, `bl`, `br`.
   */
  direction?: "t" | "b" | "l" | "r" | "tl" | "tr" | "bl" | "br";
}

const DIRECTION_CLASS: Record<NonNullable<GradientProps["direction"]>, string> = {
  t: "bg-gradient-to-t",
  b: "bg-gradient-to-b",
  l: "bg-gradient-to-l",
  r: "bg-gradient-to-r",
  tl: "bg-gradient-to-tl",
  tr: "bg-gradient-to-tr",
  bl: "bg-gradient-to-bl",
  br: "bg-gradient-to-br",
};

function presetClasses(
  preset: NonNullable<GradientProps["preset"]>,
  direction: NonNullable<GradientProps["direction"]>,
): string {
  switch (preset) {
    case "primary":
      return cn(DIRECTION_CLASS[direction], "from-primary/15 via-primary/5 to-transparent");
    case "accent":
      return cn(DIRECTION_CLASS[direction], "from-accent/40 via-accent/15 to-transparent");
    case "dusk":
      return cn(DIRECTION_CLASS[direction], "from-primary/20 via-accent/15 to-background");
    case "dawn":
      return cn(DIRECTION_CLASS[direction], "from-accent/20 via-primary/10 to-background");
    // Tailwind v4 radial utilities — raw radial-gradient() arbitrary
    // values are too paren-heavy for the JIT scanner to extract from
    // source, so they never make it into compiled CSS.
    case "radial":
      return "bg-radial-[circle_at_center] from-primary/20 to-transparent to-70%";
    case "mesh":
      // Two layered radials; rendered as stacked children below since a
      // single element can only carry one gradient utility set.
      return "";
  }
}

export function Gradient({
  preset = "primary",
  direction = "br",
  className,
  ...rest
}: GradientProps) {
  if (preset === "mesh") {
    return (
      <div
        data-slot="gradient"
        data-preset={preset}
        className={cn("relative", className)}
        {...rest}
      >
        <div className="absolute inset-0 bg-radial-[at_top_left] from-primary/25 to-transparent to-55%" />
        <div className="absolute inset-0 bg-radial-[at_bottom_right] from-accent/40 to-transparent to-60%" />
      </div>
    );
  }
  return (
    <div
      data-slot="gradient"
      data-preset={preset}
      className={cn(presetClasses(preset, direction), className)}
      {...rest}
    />
  );
}
