// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/skeleton).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
import type * as React from "react";
import { cn } from "../../lib/utils.ts";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
