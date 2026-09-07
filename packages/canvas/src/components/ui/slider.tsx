// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/slider).
// Real shadcn for the IDE chrome — NOT the canvas-safe snapshot fork.
// Regenerate with `bun run vendor`; hand-edited only for the adaptations
// below, which is why `slider` is in vendor.ts's ADAPTED set.

import { Slider as SliderPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

interface SliderProps extends React.ComponentProps<typeof SliderPrimitive.Root> {
  /** `muted` for a live control whose value isn't its own — an inherited one. */
  tone?: "primary" | "muted" | undefined;
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  tone = "primary",
  // ADAPTED: Radix puts role="slider" on the thumb, so the label has to ride
  // down with it — left on the root it names a group nothing focuses.
  "aria-label": ariaLabel,
  ...props
}: SliderProps) {
  const muted = tone === "muted";
  const _values = React.useMemo(
    () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max]),
    [value, defaultValue, min, max],
  );

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(value === undefined ? {} : { value })}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative grow overflow-hidden rounded-full bg-muted data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn(
            "absolute select-none data-horizontal:h-full data-vertical:w-full",
            muted ? "bg-muted-foreground/30" : "bg-primary",
          )}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          aria-label={ariaLabel}
          className={cn(
            muted && "border-muted-foreground/40 bg-muted",
            "relative block size-3 shrink-0 rounded-full border border-ring bg-white ring-ring/50 transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50",
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
