// Canvas-safe Dialog replacement. The upstream shadcn Dialog uses
// DialogPrimitive.Portal which targets document.body; we render the
// Content inline so the canvas iframe sees it. Forces open=true unless
// the design explicitly passes a value. See lib/canvas-portal.tsx.
"use client";

import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";
import { inlineOpenAttrs, pinOpenInDesignMode } from "../lib/canvas-portal.tsx";
import { cn } from "../lib/utils.ts";

export function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...pinOpenInDesignMode(props)} />;
}

export function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

export function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

export function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<"div"> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="dialog-content"
      {...inlineOpenAttrs()}
      className={cn(
        "relative grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-lg border bg-background p-6 shadow-lg sm:max-w-lg",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton ? (
        <div
          data-slot="dialog-close-inline"
          className="absolute top-4 right-4 inline-flex size-4 items-center justify-center rounded-xs opacity-70"
          aria-hidden="true"
        >
          <X />
        </div>
      ) : null}
    </div>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export function DialogOverlay({ className, ...props }: React.ComponentProps<"div">) {
  // Inline overlay — design mode doesn't need a portal-mounted backdrop.
  // Rendered as a flat div so the visual mass is there for screenshots.
  return (
    <div
      data-slot="dialog-overlay"
      data-velloo-inline="true"
      data-state="open"
      className={cn("fixed inset-0 z-50 bg-black/50", className)}
      {...props}
    />
  );
}
