// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/spinner).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
// Regenerate with `bun run vendor` — do not hand-edit unless you are adding a
// canvas adaptation, in which case add the id to vendor.ts's ADAPTED set.

import { Loader2Icon } from "lucide-react";
import { cn } from "../../lib/utils.ts";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
