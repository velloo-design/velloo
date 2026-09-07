// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/checkbox).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
// Canvas-safe: a design ships `checked` to show a ticked state, with no handler
// because nothing on the canvas is interactive. Radix would then hold the box
// at that value and React would warn about the missing handler, so a handlerless
// `checked` becomes `defaultChecked`.
"use client";

import { CheckIcon } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "../../lib/utils.ts";

export function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  const { checked, ...rest } = props;
  const isStaticControlled = checked !== undefined && props.onCheckedChange === undefined;
  // Drop `checked` by omitting it, not by setting it to undefined: Radix reads
  // "present but undefined" as a controlled component with no value.
  const finalProps = isStaticControlled ? { ...rest, defaultChecked: checked } : props;
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-colors outline-none group-has-disabled/field:opacity-50 group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground group-has-[:focus-visible]/field-label:data-checked:border-primary dark:data-checked:bg-primary",
        className,
      )}
      {...finalProps}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
