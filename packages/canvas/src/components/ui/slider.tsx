import { Slider as SliderPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

interface SliderProps extends React.ComponentProps<typeof SliderPrimitive.Root> {
  /** `muted` for a live control whose value isn't its own — an inherited one. */
  tone?: "primary" | "muted";
}

export function Slider({
  className,
  tone = "primary",
  // Radix puts role="slider" on the thumb, so the label has to ride down with
  // it — left on the root it names a group nothing focuses.
  "aria-label": ariaLabel,
  ...props
}: SliderProps) {
  const muted = tone === "muted";
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex w-full touch-none select-none items-center py-1.5",
        "data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn("absolute h-full", muted ? "bg-muted-foreground/30" : "bg-primary")}
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        aria-label={ariaLabel}
        className={cn(
          "block size-3.5 shrink-0 rounded-full border-2 border-background shadow-sm",
          muted ? "bg-muted-foreground/45" : "bg-primary",
          "outline-none transition-[box-shadow] focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        )}
      />
    </SliderPrimitive.Root>
  );
}
