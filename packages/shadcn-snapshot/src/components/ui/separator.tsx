// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/separator).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
// Regenerate with `bun run vendor` — do not hand-edit unless you are adding a
// canvas adaptation, in which case add the id to vendor.ts's ADAPTED set.
"use client";

import { Separator as SeparatorPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "../../lib/utils.ts";

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
