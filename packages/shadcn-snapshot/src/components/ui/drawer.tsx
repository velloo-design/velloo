// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/drawer).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
//
// Canvas-safe: see ../canvas-portal.tsx. Upstream builds on vaul, whose Root
// owns a drag gesture and portals Content to the body once open — neither
// survives a static render, so nothing of the drawer would reach the design
// surface. The whole family is plain elements here, which also keeps vaul out
// of the dependency tree; `emit_code` still emits `Drawer`, so the user's app
// gets the real one from its own components/ui/drawer.
//
// `data-vaul-drawer-direction` is preserved because upstream's entire layout
// hangs off it — the direction the caller asked for still styles correctly.
"use client";

import type * as React from "react";
import { cn } from "../../lib/utils.ts";
import { inlineOpenAttrs } from "../canvas-portal.tsx";

type Direction = "top" | "bottom" | "left" | "right";

export function Drawer({ ...props }: React.ComponentProps<"div">) {
  return <div data-slot="drawer" {...props} />;
}

export function DrawerTrigger({ ...props }: React.ComponentProps<"button">) {
  return <button type="button" data-slot="drawer-trigger" {...props} />;
}

export function DrawerPortal({ children }: React.ComponentProps<"div">) {
  return <>{children}</>;
}

export function DrawerClose({ ...props }: React.ComponentProps<"button">) {
  return <button type="button" data-slot="drawer-close" {...props} />;
}

export function DrawerOverlay({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-overlay"
      {...inlineOpenAttrs()}
      className={cn("absolute inset-0 z-40 bg-black/10", className)}
      {...props}
    />
  );
}

export function DrawerContent({
  className,
  children,
  direction = "bottom",
  ...props
}: React.ComponentProps<"div"> & { direction?: Direction }) {
  return (
    <div
      data-slot="drawer-content"
      data-vaul-drawer-direction={direction}
      {...inlineOpenAttrs()}
      className={cn(
        "group/drawer-content z-50 flex h-auto flex-col bg-popover text-sm text-popover-foreground data-[vaul-drawer-direction=bottom]:mt-24 data-[vaul-drawer-direction=bottom]:rounded-t-xl data-[vaul-drawer-direction=bottom]:border-t data-[vaul-drawer-direction=left]:w-3/4 data-[vaul-drawer-direction=left]:rounded-r-xl data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=right]:w-3/4 data-[vaul-drawer-direction=right]:rounded-l-xl data-[vaul-drawer-direction=right]:border-l data-[vaul-drawer-direction=top]:mb-24 data-[vaul-drawer-direction=top]:rounded-b-xl data-[vaul-drawer-direction=top]:border-b data-[vaul-drawer-direction=left]:sm:max-w-sm data-[vaul-drawer-direction=right]:sm:max-w-sm",
        className,
      )}
      {...props}
    >
      <div className="mx-auto mt-4 hidden h-1 w-[100px] shrink-0 rounded-full bg-muted group-data-[vaul-drawer-direction=bottom]/drawer-content:block" />
      {children}
    </div>
  );
}

export function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex flex-col gap-0.5 p-4 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-center group-data-[vaul-drawer-direction=top]/drawer-content:text-center md:text-left",
        className,
      )}
      {...props}
    />
  );
}

export function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

export function DrawerTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-title"
      className={cn("cn-font-heading font-medium", className)}
      {...props}
    />
  );
}

export function DrawerDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}
