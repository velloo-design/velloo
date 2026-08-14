// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/toggle-group).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
"use client";

import type { VariantProps } from "class-variance-authority";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import type * as React from "react";
import { createContext, useContext } from "react";
import { cn } from "../../lib/utils.ts";
import { toggleVariants } from "./toggle.tsx";

const ToggleGroupContext = createContext<VariantProps<typeof toggleVariants>>({
  size: "default",
  variant: "default",
});

export interface ToggleGroupProps extends VariantProps<typeof toggleVariants> {
  className?: string;
  children?: React.ReactNode;
  type?: "single" | "multiple";
  value?: string | string[];
  defaultValue?: string | string[];
  disabled?: boolean;
}

export function ToggleGroup({
  className,
  variant,
  size,
  type = "single",
  children,
  ...props
  // biome-ignore lint/suspicious/noExplicitAny: radix discriminated props fight us in design mode
}: any) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      type={type as "single"}
      className={cn(
        "group/toggle-group inline-flex w-fit items-center rounded-md data-[variant=outline]:shadow-xs",
        className,
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  );
}

export function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>) {
  const context = useContext(ToggleGroupContext);
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={context.variant ?? variant}
      data-size={context.size ?? size}
      className={cn(
        toggleVariants({ variant: context.variant ?? variant, size: context.size ?? size }),
        "min-w-0 flex-1 shrink-0 rounded-none shadow-none first:rounded-l-md last:rounded-r-md focus:z-10 focus-visible:z-10 data-[variant=outline]:border-l-0 data-[variant=outline]:first:border-l",
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
}
