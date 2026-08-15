// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/select).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
// Canvas-safe: see ../canvas-portal.tsx.
//
// Select is the most divergent canvas-safe shim. Radix Select drives
// its trigger label from the currently-selected SelectItem inside its
// Portal; with the portal bypassed the trigger would render blank. We
// keep Radix's Root + Trigger for the open state but render the value
// label via a free-standing element that the user controls explicitly.
"use client";

import { Check, ChevronDown } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import type * as React from "react";
import { inlineOpenAttrs, pinOpenInDesignMode } from "../lib/canvas-portal.tsx";
import { cn } from "../lib/utils.ts";

export function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...pinOpenInDesignMode(props)} />;
}

export function SelectGroup({ ...props }: React.ComponentProps<"div">) {
  return <div data-slot="select-group" {...props} />;
}

/**
 * Static value display — agent-emitted code uses Radix's `SelectValue`
 * inside the Portal; design mode renders the value here so users see
 * "Pro plan" sitting next to the chevron. Pass `placeholder` if the
 * design wants an empty state.
 */
export function SelectValue({
  placeholder,
  children,
}: {
  placeholder?: string;
  children?: React.ReactNode;
}) {
  return <span data-slot="select-value">{children ?? placeholder ?? ""}</span>;
}

export function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<"button"> & { size?: "default" | "sm" }) {
  return (
    <button
      type="button"
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs outline-none transition-[color,box-shadow] hover:bg-accent/30 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8" : "h-9",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown className="size-4 opacity-50" />
    </button>
  );
}

export function SelectContent({
  className,
  position: _position,
  ...props
}: React.ComponentProps<"div"> & { position?: "popper" | "item-aligned" }) {
  return (
    <div
      data-slot="select-content"
      {...inlineOpenAttrs()}
      className={cn(
        "z-50 mt-1 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md",
        className,
      )}
      {...props}
    />
  );
}

export function SelectLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

export function SelectItem({
  className,
  children,
  value,
  selected,
  ...props
}: React.ComponentProps<"div"> & { value?: string; selected?: boolean }) {
  return (
    <div
      data-slot="select-item"
      data-value={value}
      data-state={selected ? "checked" : "unchecked"}
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm hover:bg-accent",
        className,
      )}
      {...props}
    >
      <span className="flex-1">{children}</span>
      {selected ? (
        <span className="absolute right-2 flex size-3.5 items-center justify-center">
          <Check className="size-4" />
        </span>
      ) : null}
    </div>
  );
}

export function SelectSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="select-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}
