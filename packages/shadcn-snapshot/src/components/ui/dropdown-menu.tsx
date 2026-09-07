// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/dropdown-menu).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
// Canvas-safe: see ../canvas-portal.tsx. Everything from Content inward is a
// plain element — Radix's menu parts read a context Portal/Content sets up, so
// they can't render standalone, and the popup has to be inline for the design
// surface to see it. Classes track upstream except for the ones that depend on
// Radix's runtime positioning vars (`--radix-dropdown-menu-*`) or animate on
// open, which would leave screenshots catching a mid-transition frame.
"use client";

import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";
import { inlineOpenAttrs, pinOpenInDesignMode } from "../canvas-portal.tsx";

const POPUP =
  "cn-menu-target cn-menu-translucent z-50 min-w-32 overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground ring-1 ring-foreground/10";

const ITEM =
  "relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const CHECKABLE_ITEM =
  "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

export function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...pinOpenInDesignMode(props)} />;
}

export function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

/** Upstream's Portal, neutralized: children render where they sit. */
export function DropdownMenuPortal({ children }: React.ComponentProps<"div">) {
  return <>{children}</>;
}

export function DropdownMenuContent({
  className,
  sideOffset: _sideOffset,
  align: _align,
  ...props
}: React.ComponentProps<"div"> & { sideOffset?: number; align?: string }) {
  return (
    <div
      data-slot="dropdown-menu-content"
      {...inlineOpenAttrs()}
      className={cn(POPUP, className)}
      {...props}
    />
  );
}

export function DropdownMenuGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dropdown-menu-group" className={className} {...props} />;
}

export function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { inset?: boolean; variant?: "default" | "destructive" }) {
  return (
    <div
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/dropdown-menu-item",
        ITEM,
        "not-data-[variant=destructive]:focus:**:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:*:[svg]:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<"div"> & { checked?: boolean }) {
  return (
    <div
      data-slot="dropdown-menu-checkbox-item"
      data-state={checked ? "checked" : "unchecked"}
      className={cn(CHECKABLE_ITEM, className)}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-3.5 items-center justify-center">
        {checked ? <CheckIcon className="size-4" /> : null}
      </span>
      {children}
    </div>
  );
}

export function DropdownMenuRadioGroup({ ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dropdown-menu-radio-group" {...props} />;
}

export function DropdownMenuRadioItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<"div"> & { checked?: boolean }) {
  return (
    <div
      data-slot="dropdown-menu-radio-item"
      data-state={checked ? "checked" : "unchecked"}
      className={cn(CHECKABLE_ITEM, className)}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-3.5 items-center justify-center">
        {checked ? <CircleIcon className="size-2 fill-current" /> : null}
      </span>
      {children}
    </div>
  );
}

export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<"div"> & { inset?: boolean }) {
  return (
    <div
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

export function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<"div"> & { inset?: boolean }) {
  return (
    <div
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(ITEM, "data-open:bg-accent data-open:text-accent-foreground", className)}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </div>
  );
}

export function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dropdown-menu-sub-content"
      className={cn(POPUP, "min-w-[96px] shadow-lg", className)}
      {...props}
    />
  );
}
