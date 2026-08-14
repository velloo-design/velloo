// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/toast).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
//
// Canvas-safe: real toasts portal to body + animate in. Design mode
// renders the styled card statically pinned wherever the designer
// places it. The agent's emitted code uses the real shadcn Toast at
// runtime — this is design-only chrome.
"use client";

import { X } from "lucide-react";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";

export function ToastProvider({ children }: { children: React.ReactNode }) {
  // Pure pass-through. The real Toast.Provider manages queue + dismiss;
  // in design mode the toast is always visible.
  return <>{children}</>;
}

export function Toaster({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toaster"
      className={cn("fixed bottom-4 right-4 z-50 flex max-w-md flex-col gap-2", className)}
      {...props}
    />
  );
}

export interface ToastProps extends React.ComponentProps<"div"> {
  variant?: "default" | "destructive";
}

export function Toast({ className, variant = "default", ...props }: ToastProps) {
  return (
    <div
      role="status"
      data-slot="toast"
      data-variant={variant}
      data-state="open"
      className={cn(
        "pointer-events-auto flex w-full items-start gap-3 rounded-md border p-4 shadow-lg",
        variant === "default" && "border-border bg-background text-foreground",
        variant === "destructive" && "border-destructive bg-destructive/10 text-destructive",
        className,
      )}
      {...props}
    />
  );
}

export function ToastTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="toast-title" className={cn("text-sm font-semibold", className)} {...props} />
  );
}

export function ToastDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="toast-description" className={cn("text-sm opacity-90", className)} {...props} />
  );
}

export function ToastAction({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="toast-action"
      className={cn(
        "ml-auto inline-flex h-7 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function ToastClose({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="toast-close"
      aria-label="Close"
      className={cn(
        "shrink-0 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100",
        className,
      )}
      {...props}
    >
      <X className="size-4" />
    </button>
  );
}
