// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/menubar).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
// Canvas-safe: see ../canvas-portal.tsx. The bar itself renders fine, but a
// menu's popup portals to the body and only mounts while that menu is open, so
// a static render would show the triggers and nothing else. Everything from
// Content inward is a plain element — Radix's menu parts read a context
// Portal/Content sets up, so they can't render standalone, and the popup has to
// be inline for the design surface to see it. Classes track upstream except for
// the ones that depend on Radix's runtime positioning vars (`--radix-menubar-*`)
// or animate on open, which would leave screenshots catching a mid-transition
// frame.
"use client";

import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { Menubar as MenubarPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";
import { inlineOpenAttrs } from "../canvas-portal.tsx";

const POPUP =
  "cn-menu-target cn-menu-translucent z-50 overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground ring-1 ring-foreground/10";

const ITEM =
  "relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const CHECKABLE_ITEM =
  "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-1.5 pl-7 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0";

const INDICATOR =
  "pointer-events-none absolute left-1.5 flex size-4 items-center justify-center [&_svg:not([class*='size-'])]:size-4";

export function Menubar({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Root>) {
  return (
    <MenubarPrimitive.Root
      data-slot="menubar"
      className={cn("flex h-8 items-center gap-0.5 rounded-lg border p-[3px]", className)}
      {...props}
    />
  );
}

/**
 * The one menu shell that needs no design-mode pin: Radix tracks the open menu
 * as a value on the bar rather than a flag here, and Content renders inline
 * anyway.
 */
export function MenubarMenu({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Menu>) {
  return <MenubarPrimitive.Menu data-slot="menubar-menu" {...props} />;
}

export function MenubarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="menubar-group" className={className} {...props} />;
}

/** Upstream's Portal, neutralized: children render where they sit. */
export function MenubarPortal({ children }: React.ComponentProps<"div">) {
  return <>{children}</>;
}

export function MenubarRadioGroup({ ...props }: React.ComponentProps<"div">) {
  return <div data-slot="menubar-radio-group" {...props} />;
}

export function MenubarTrigger({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Trigger>) {
  return (
    <MenubarPrimitive.Trigger
      data-slot="menubar-trigger"
      className={cn(
        "flex items-center rounded-sm px-1.5 py-[2px] text-sm font-medium outline-hidden select-none hover:bg-muted aria-expanded:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

export function MenubarContent({
  className,
  sideOffset: _sideOffset,
  align: _align,
  alignOffset: _alignOffset,
  collisionPadding: _collisionPadding,
  ...props
}: React.ComponentProps<"div"> & {
  sideOffset?: number;
  align?: string;
  alignOffset?: number;
  collisionPadding?: number;
}) {
  return (
    <div
      data-slot="menubar-content"
      {...inlineOpenAttrs()}
      className={cn(POPUP, "min-w-36 shadow-md", className)}
      {...props}
    />
  );
}

export function MenubarItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { inset?: boolean; variant?: "default" | "destructive" }) {
  return (
    <div
      data-slot="menubar-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/menubar-item",
        ITEM,
        "not-data-[variant=destructive]:focus:**:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:*:[svg]:text-destructive!",
        className,
      )}
      {...props}
    />
  );
}

export function MenubarCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<"div"> & { checked?: boolean; inset?: boolean }) {
  return (
    <div
      data-slot="menubar-checkbox-item"
      data-inset={inset}
      data-state={checked ? "checked" : "unchecked"}
      className={cn(CHECKABLE_ITEM, className)}
      {...props}
    >
      <span className={INDICATOR}>{checked ? <CheckIcon /> : null}</span>
      {children}
    </div>
  );
}

export function MenubarRadioItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<"div"> & { checked?: boolean; inset?: boolean }) {
  return (
    <div
      data-slot="menubar-radio-item"
      data-inset={inset}
      data-state={checked ? "checked" : "unchecked"}
      className={cn(
        CHECKABLE_ITEM,
        "data-disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span className={INDICATOR}>{checked ? <CheckIcon /> : null}</span>
      {children}
    </div>
  );
}

export function MenubarLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<"div"> & { inset?: boolean }) {
  return (
    <div
      data-slot="menubar-label"
      data-inset={inset}
      className={cn("px-1.5 py-1 text-sm font-medium data-inset:pl-7", className)}
      {...props}
    />
  );
}

export function MenubarSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="menubar-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export function MenubarShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="menubar-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-focus/menubar-item:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function MenubarSub({ ...props }: React.ComponentProps<typeof MenubarPrimitive.Sub>) {
  return <MenubarPrimitive.Sub data-slot="menubar-sub" {...props} />;
}

export function MenubarSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<"div"> & { inset?: boolean }) {
  return (
    <div
      data-slot="menubar-sub-trigger"
      data-inset={inset}
      className={cn(ITEM, "data-open:bg-accent data-open:text-accent-foreground", className)}
      {...props}
    >
      {children}
      <ChevronRightIcon className="cn-rtl-flip ml-auto size-4" />
    </div>
  );
}

export function MenubarSubContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="menubar-sub-content"
      className={cn(POPUP, "min-w-32 shadow-lg", className)}
      {...props}
    />
  );
}
