// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/sheet).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
// Canvas-safe: see ../canvas-portal.tsx. Content is a plain panel in the page
// flow, so upstream's viewport-edge anchoring goes away while `data-side` keeps
// driving the per-side size and border — a fixed panel would pin itself to the
// canvas viewport instead of the frame it belongs to. The close button is a
// plain Button rather than Radix Close, so a Content placed on the canvas
// without its Root still renders. Classes track upstream minus the slide/fade
// transitions: we pin `data-state="open"`, so those would replay on every
// render and screenshots would catch a mid-transition frame.
"use client";

import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";
import { inlineOpenAttrs, pinOpenInDesignMode } from "../canvas-portal.tsx";
import { Button } from "./button.tsx";

export function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...pinOpenInDesignMode(props)} />;
}

export function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

export function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

export function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="sheet-content"
      data-side={side}
      {...inlineOpenAttrs()}
      className={cn(
        "relative z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <Button
          data-slot="sheet-close"
          variant="ghost"
          className="absolute top-3 right-3"
          size="icon-sm"
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </Button>
      )}
    </div>
  );
}

export function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  );
}

export function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

export function SheetTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="sheet-title"
      className={cn("cn-font-heading text-base font-medium text-foreground", className)}
      {...props}
    />
  );
}

export function SheetDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}
