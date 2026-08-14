// Velloo-owned decorative divider. shadcn's Separator is a single
// border-bg-border rule — fine for app chrome but too plain for
// marketing pages. Divider adds variant styles (dotted, gradient,
// pinched) and a label slot for "OR" / "section break" usage.
import type * as React from "react";
import { cn } from "../../lib/utils.ts";

export interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "solid" | "dotted" | "dashed" | "gradient" | "pinched";
  orientation?: "horizontal" | "vertical";
  /** Optional centered label, like "OR" or "section break". */
  label?: string;
  /** Color source — semantic token name; defaults to border. */
  color?: "border" | "muted" | "primary" | "accent";
}

const COLOR_BORDER: Record<NonNullable<DividerProps["color"]>, string> = {
  border: "border-border",
  muted: "border-muted-foreground/30",
  primary: "border-primary/40",
  accent: "border-accent/60",
};

const COLOR_BG: Record<NonNullable<DividerProps["color"]>, string> = {
  border: "from-border via-border to-border",
  muted: "from-transparent via-muted-foreground/40 to-transparent",
  primary: "from-transparent via-primary to-transparent",
  accent: "from-transparent via-accent to-transparent",
};

const VARIANT_BORDER: Record<NonNullable<DividerProps["variant"]>, string> = {
  solid: "border-solid",
  dotted: "border-dotted",
  dashed: "border-dashed",
  gradient: "",
  pinched: "border-solid",
};

export function Divider({
  variant = "solid",
  orientation = "horizontal",
  label,
  color = "border",
  className,
  ...rest
}: DividerProps) {
  if (label) {
    return (
      <div
        data-slot="divider"
        data-variant={variant}
        className={cn(
          "flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground",
          className,
        )}
        {...rest}
      >
        <span
          className={cn(
            "flex-1",
            variant === "gradient"
              ? cn("h-px bg-gradient-to-r", COLOR_BG[color])
              : cn("border-t", VARIANT_BORDER[variant], COLOR_BORDER[color]),
          )}
        />
        <span className="shrink-0">{label}</span>
        <span
          className={cn(
            "flex-1",
            variant === "gradient"
              ? cn("h-px bg-gradient-to-r", COLOR_BG[color])
              : cn("border-t", VARIANT_BORDER[variant], COLOR_BORDER[color]),
          )}
        />
      </div>
    );
  }

  if (variant === "gradient") {
    return (
      <div
        data-slot="divider"
        data-variant="gradient"
        className={cn(
          orientation === "horizontal" ? "h-px w-full" : "w-px self-stretch",
          "bg-gradient-to-r",
          COLOR_BG[color],
          className,
        )}
        {...rest}
      />
    );
  }

  if (variant === "pinched") {
    return (
      <div
        data-slot="divider"
        data-variant="pinched"
        className={cn("flex items-center justify-center w-full", className)}
        {...rest}
      >
        <span className={cn("h-px w-16 border-t", COLOR_BORDER[color])} />
        <span className={cn("mx-1 size-1.5 rounded-full", COLOR_BG[color].split(" ")[1] ?? "")} />
        <span className={cn("h-px w-16 border-t", COLOR_BORDER[color])} />
      </div>
    );
  }

  return (
    <div
      data-slot="divider"
      data-variant={variant}
      className={cn(
        orientation === "horizontal"
          ? cn("w-full border-t", VARIANT_BORDER[variant], COLOR_BORDER[color])
          : cn("self-stretch border-l", VARIANT_BORDER[variant], COLOR_BORDER[color]),
        className,
      )}
      {...rest}
    />
  );
}
