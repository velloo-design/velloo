// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/context-menu).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
// Canvas-safe: see ../canvas-portal.tsx. A context menu only opens on
// right-click and portals to the body, so a static render would show the
// trigger and nothing else. Everything from Content inward is a plain element —
// Radix's menu parts read a context Portal/Content sets up, so they can't
// render standalone, and the popup has to be inline for the design surface to
// see it. Classes track upstream except for the ones that depend on Radix's
// runtime positioning vars (`--radix-context-menu-*`) or animate on open, which
// would leave screenshots catching a mid-transition frame.
"use client";

import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";
import { inlineOpenAttrs, pinOpenInDesignMode } from "../canvas-portal.tsx";

const POPUP =
  "cn-menu-target cn-menu-translucent z-50 rounded-lg bg-popover p-1 text-popover-foreground";

const ITEM =
  "relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const CHECKABLE_ITEM =
  "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const INDICATOR = "pointer-events-none absolute right-2";

export function ContextMenu({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...pinOpenInDesignMode(props)} />;
}

export function ContextMenuTrigger({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      className={cn("select-none", className)}
      {...props}
    />
  );
}

export function ContextMenuGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="context-menu-group" className={className} {...props} />;
}

/** Upstream's Portal, neutralized: children render where they sit. */
export function ContextMenuPortal({ children }: React.ComponentProps<"div">) {
  return <>{children}</>;
}

export function ContextMenuSub({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />;
}

export function ContextMenuRadioGroup({ ...props }: React.ComponentProps<"div">) {
  return <div data-slot="context-menu-radio-group" {...props} />;
}

export function ContextMenuContent({
  className,
  side: _side,
  sideOffset: _sideOffset,
  align: _align,
  alignOffset: _alignOffset,
  collisionPadding: _collisionPadding,
  ...props
}: React.ComponentProps<"div"> & {
  side?: string;
  sideOffset?: number;
  align?: string;
  alignOffset?: number;
  collisionPadding?: number;
}) {
  return (
    <div
      data-slot="context-menu-content"
      {...inlineOpenAttrs()}
      className={cn(
        POPUP,
        "min-w-36 overflow-x-hidden overflow-y-auto shadow-md ring-1 ring-foreground/10",
        className,
      )}
      {...props}
    />
  );
}

export function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { inset?: boolean; variant?: "default" | "destructive" }) {
  return (
    <div
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/context-menu-item",
        ITEM,
        "focus:*:[svg]:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:*:[svg]:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

export function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<"div"> & { inset?: boolean }) {
  return (
    <div
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(ITEM, "data-open:bg-accent data-open:text-accent-foreground", className)}
      {...props}
    >
      {children}
      <ChevronRightIcon className="cn-rtl-flip ml-auto" />
    </div>
  );
}

export function ContextMenuSubContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="context-menu-sub-content"
      className={cn(POPUP, "min-w-32 overflow-hidden border shadow-lg", className)}
      {...props}
    />
  );
}

export function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<"div"> & { checked?: boolean; inset?: boolean }) {
  return (
    <div
      data-slot="context-menu-checkbox-item"
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

export function ContextMenuRadioItem({
  className,
  children,
  checked,
  inset,
  ...props
}: React.ComponentProps<"div"> & { checked?: boolean; inset?: boolean }) {
  return (
    <div
      data-slot="context-menu-radio-item"
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

export function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<"div"> & { inset?: boolean }) {
  return (
    <div
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn(
        "px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7",
        className,
      )}
      {...props}
    />
  );
}

export function ContextMenuSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="context-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export function ContextMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-focus/context-menu-item:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}
