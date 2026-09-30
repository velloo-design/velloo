// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/spinner).
// Design-mode fork for the Velloo canvas — not the shadcn the IDE chrome renders.
// Regenerate with `bun run vendor` — the pipeline is scripts/vendor-shadcn/.

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
