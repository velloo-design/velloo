// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/skeleton).
// Design-mode fork for the Velloo canvas — not the shadcn the IDE chrome renders.
// Regenerate with `bun run vendor` — the pipeline is scripts/vendor-shadcn/.
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
