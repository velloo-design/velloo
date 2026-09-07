// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/skeleton).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
// Regenerate with `bun run vendor` — do not hand-edit unless you are adding a
// canvas adaptation, in which case add the id to vendor.ts's ADAPTED set.
import { cn } from "../../lib/utils.ts";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
