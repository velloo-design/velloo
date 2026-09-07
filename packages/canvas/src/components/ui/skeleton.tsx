// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/skeleton).
// Real shadcn for the IDE chrome — NOT the canvas-safe snapshot fork.
// Regenerate with `bun run vendor`; do not hand-edit.
import { cn } from "@/lib/utils";

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
