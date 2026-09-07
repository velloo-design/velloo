// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/textarea).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
// Canvas-safe: same contract as Input — designs ship a `value` with no handler
// to show populated copy, and React warns about a controlled field it can never
// update, so `value` without `onChange` opts into `readOnly`.
import type * as React from "react";

import { cn } from "../../lib/utils.ts";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  const isStaticControlled =
    props.value !== undefined && props.onChange === undefined && props.readOnly === undefined;
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
      readOnly={isStaticControlled ? true : props.readOnly}
    />
  );
}
