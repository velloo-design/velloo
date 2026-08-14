// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/progress).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
"use client";

import { Progress as ProgressPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";

export function Progress({
  className,
  value = 0,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - (Number(value) || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
