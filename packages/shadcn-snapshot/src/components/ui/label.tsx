// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/label).
// Design-mode fork for the Velloo canvas — not the shadcn the IDE chrome renders.
// Regenerate with `bun run vendor` — the pipeline is scripts/vendor-shadcn/.
"use client";

import { Label as LabelPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
