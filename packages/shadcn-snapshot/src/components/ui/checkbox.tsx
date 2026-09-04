// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/checkbox).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
"use client";

import { Check } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";

export function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  // Canvas-safe contract: a `checked` prop without `onCheckedChange`
  // means the design is showing a static "ticked" state — promote it to
  // `defaultChecked` so React doesn't warn about a missing handler.
  const { checked, ...rest } = props;
  const isStaticControlled = checked !== undefined && props.onCheckedChange === undefined;
  // Drop `checked` by omitting it, not by setting it to undefined: Radix reads
  // "present but undefined" as a controlled component with no value.
  const finalProps = isStaticControlled ? { ...rest, defaultChecked: checked } : props;
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[4px] border border-input shadow-xs outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...finalProps}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <Check className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
