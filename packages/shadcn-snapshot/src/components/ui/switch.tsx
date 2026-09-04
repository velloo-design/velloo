// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/switch).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  // Canvas-safe: `checked` without a handler → `defaultChecked` to
  // suppress React's controlled-component warning in design mode.
  const { checked, ...rest } = props;
  const isStaticControlled = checked !== undefined && props.onCheckedChange === undefined;
  // Drop `checked` by omitting it, not by setting it to undefined: Radix reads
  // "present but undefined" as a controlled component with no value.
  const finalProps = isStaticControlled ? { ...rest, defaultChecked: checked } : props;
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted",
        className,
      )}
      {...finalProps}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  );
}
