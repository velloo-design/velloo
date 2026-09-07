// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/select).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
// Canvas-safe: see ../canvas-portal.tsx. Select is the most divergent shim.
// Radix drives the trigger label and the item check mark through a context
// that Portal/Content set up, so once the popup renders inline that channel is
// dead — the label is authored on `SelectValue` and the check on `SelectItem`'s
// `selected`, which also puts both under inspector control. Classes track
// upstream minus the ones keyed to Radix's runtime vars
// (`--radix-select-*`) or to the open animation, which would fire on every
// render and leave screenshots catching a mid-transition frame.
"use client";

import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";
import { inlineOpenAttrs, pinOpenInDesignMode } from "../canvas-portal.tsx";

const SCROLL_BUTTON =
  "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4";

export function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...pinOpenInDesignMode(props)} />;
}

/**
 * A plain button, not `SelectPrimitive.Trigger`: the rest of this file already
 * bypasses Radix (Content, Item and Value are inline elements), so the root's
 * context has nothing left to give a trigger — while Radix's own trigger
 * *throws* when it can't find that context. Designs compose nodes freely, so a
 * trigger sitting on its own under a Box is a shape the canvas has to render,
 * not a crash that takes the whole screen down with it.
 */
export function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<"button"> & {
  size?: "sm" | "default";
}) {
  return (
    <button
      type="button"
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
    </button>
  );
}

/**
 * Static value display. Radix reads the label off the selected item, which
 * only exists inside the portal it owns; design mode renders whatever the
 * user typed so the trigger reads "Pro plan" next to the chevron. Pass
 * `placeholder` alone for the empty state — it takes upstream's muted styling
 * here rather than through the trigger's `data-placeholder`.
 */
export function SelectValue({
  className,
  placeholder,
  children,
  ...props
}: React.ComponentProps<"span"> & { placeholder?: string }) {
  return (
    <span
      data-slot="select-value"
      className={children === undefined ? cn("text-muted-foreground", className) : className}
      {...props}
    >
      {children ?? placeholder ?? ""}
    </span>
  );
}

export function SelectContent({
  className,
  position: _position,
  align: _align,
  side: _side,
  sideOffset: _sideOffset,
  collisionPadding: _collisionPadding,
  ...props
}: React.ComponentProps<"div"> & {
  position?: "popper" | "item-aligned";
  align?: string;
  side?: string;
  sideOffset?: number;
  collisionPadding?: number;
}) {
  return (
    <div
      data-slot="select-content"
      {...inlineOpenAttrs()}
      className={cn(
        "cn-menu-target cn-menu-translucent relative z-50 min-w-36 overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
        className,
      )}
      {...props}
    />
  );
}

export function SelectGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="select-group" className={cn("scroll-my-1 p-1", className)} {...props} />;
}

export function SelectLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
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
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        {selected ? <CheckIcon className="pointer-events-none" /> : null}
      </span>
      <span>{children}</span>
    </div>
  );
}

export function SelectSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

/**
 * Upstream renders both scroll buttons inside Content and lets Radix hide them
 * until the list actually overflows. A static render can't measure that, so
 * they stay opt-in children rather than always-on chrome.
 */
export function SelectScrollUpButton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="select-scroll-up-button" className={cn(SCROLL_BUTTON, className)} {...props}>
      <ChevronUpIcon />
    </div>
  );
}

export function SelectScrollDownButton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="select-scroll-down-button" className={cn(SCROLL_BUTTON, className)} {...props}>
      <ChevronDownIcon />
    </div>
  );
}
