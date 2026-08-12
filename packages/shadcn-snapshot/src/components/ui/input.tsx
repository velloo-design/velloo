// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/input).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
import type * as React from "react";
import { cn } from "../../lib/utils.ts";

/**
 * The data-*-ignore attributes defeat LastPass / 1Password / Bitwarden so they
 * don't decorate Velloo design inputs with their UI. `autoComplete="off"` is the
 * standard browser hint. All can be overridden by passing the prop explicitly.
 */
export function Input({
  className,
  type,
  autoComplete = "off",
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      autoComplete={autoComplete}
      data-slot="input"
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      data-form-type="other"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}
