// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/spinner).
// Real shadcn for the IDE chrome — NOT the canvas-safe snapshot fork.
// Regenerate with `bun run vendor` — the pipeline is scripts/vendor-shadcn/.

import { Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

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
