// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/slider).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
"use client";

import { Slider as SliderPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";

export function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  // Static "controlled" value with no handler → promote to defaultValue
  // so React doesn't warn in design mode.
  const isStatic = value !== undefined && props.onValueChange === undefined;
  // Only the keys that are set — an explicit `value: undefined` reads to Radix
  // as a controlled slider with no value, which is not what "unset" means.
  const resolved: { value?: typeof value; defaultValue?: typeof defaultValue } = isStatic
    ? { defaultValue: value }
    : {
        ...(value !== undefined ? { value } : {}),
        ...(defaultValue !== undefined ? { defaultValue } : {}),
      };
  const fallback = Array.isArray(resolved.defaultValue ?? resolved.value)
    ? (resolved.defaultValue ?? resolved.value)
    : [min];
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      min={min}
      max={max}
      {...resolved}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
        />
      </SliderPrimitive.Track>
      {Array.isArray(fallback) ? (
        fallback.map((_, i) => (
          <SliderPrimitive.Thumb
            // biome-ignore lint/suspicious/noArrayIndexKey: thumbs are fixed-count + stable per defaultValue
            key={i}
            data-slot="slider-thumb"
            className="border-primary bg-background ring-ring/50 block size-4 shrink-0 rounded-full border shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
          />
        ))
      ) : (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          className="border-primary bg-background ring-ring/50 block size-4 shrink-0 rounded-full border shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        />
      )}
    </SliderPrimitive.Root>
  );
}
