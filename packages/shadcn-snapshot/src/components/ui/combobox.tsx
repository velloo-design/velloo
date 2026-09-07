// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/combobox).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
//
// Canvas-safe: see ../canvas-portal.tsx. Upstream's Combobox is the one shadcn
// component built on Base UI rather than Radix, and all of it — filtering, the
// highlighted item, the anchored popup — is runtime behaviour that a static
// render has nothing to show for. Rendering the family as plain elements keeps
// a second component library out of the dependency tree for a component whose
// design surface is just "an input with a list under it". `emit_code` still
// emits `Combobox`, so the app gets the real Base UI one from its own
// components/ui/combobox.
//
// Sizing classes that read Base UI's anchor vars (`--anchor-width`,
// `--available-height`) are dropped; nothing sets them without the positioner.
"use client";

import { ChevronDownIcon, XIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";
import { inlineOpenAttrs } from "../canvas-portal.tsx";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./input-group.tsx";

export function Combobox({ ...props }: React.ComponentProps<"div">) {
  return <div data-slot="combobox" {...props} />;
}

export function ComboboxValue({ ...props }: React.ComponentProps<"span">) {
  return <span data-slot="combobox-value" {...props} />;
}

export function ComboboxTrigger({ className, children, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="combobox-trigger"
      className={cn("[&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    >
      {children}
      <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
    </button>
  );
}

export function ComboboxClear({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <InputGroupButton
      data-slot="combobox-clear"
      variant="ghost"
      size="icon-xs"
      className={className}
      {...props}
    >
      <XIcon className="pointer-events-none" />
    </InputGroupButton>
  );
}

export function ComboboxInput({
  className,
  disabled = false,
  showTrigger = true,
  showClear = false,
  ...props
}: React.ComponentProps<"input"> & { showTrigger?: boolean; showClear?: boolean }) {
  return (
    <InputGroup className={cn("w-auto", className)}>
      <InputGroupInput disabled={disabled} {...props} />
      <InputGroupAddon align="inline-end">
        {showClear ? <ComboboxClear disabled={disabled} /> : null}
        {showTrigger ? (
          <InputGroupButton size="icon-xs" variant="ghost" disabled={disabled}>
            <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
          </InputGroupButton>
        ) : null}
      </InputGroupAddon>
    </InputGroup>
  );
}

export function ComboboxContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="combobox-content"
      {...inlineOpenAttrs()}
      className={cn(
        "cn-menu-target cn-menu-translucent group/combobox-content relative overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
        className,
      )}
      {...props}
    />
  );
}

export function ComboboxList({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="combobox-list"
      className={cn(
        "no-scrollbar max-h-72 scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0",
        className,
      )}
      {...props}
    />
  );
}

export function ComboboxItem({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="combobox-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export function ComboboxGroup({ ...props }: React.ComponentProps<"div">) {
  return <div data-slot="combobox-group" {...props} />;
}

export function ComboboxLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="combobox-label"
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export function ComboboxCollection({ children }: React.ComponentProps<"div">) {
  return <>{children}</>;
}

export function ComboboxEmpty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="combobox-empty"
      className={cn(
        "hidden w-full justify-center py-2 text-center text-sm text-muted-foreground group-data-empty/combobox-content:flex",
        className,
      )}
      {...props}
    />
  );
}

export function ComboboxSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="combobox-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export function ComboboxChips({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="combobox-chips"
      className={cn(
        "flex min-h-8 flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent bg-clip-padding px-2.5 py-1 text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-aria-invalid:border-destructive has-aria-invalid:ring-3 has-aria-invalid:ring-destructive/20 has-data-[slot=combobox-chip]:px-1 dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}

export function ComboboxChip({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="combobox-chip"
      className={cn(
        "flex h-[calc(--spacing(5.25))] w-fit items-center justify-center gap-1 rounded-sm bg-muted px-1.5 text-xs font-medium whitespace-nowrap text-foreground has-disabled:pointer-events-none has-disabled:opacity-50 has-data-[slot=combobox-chip-remove]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

export function ComboboxChipsInput({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="combobox-chip-input"
      className={cn("min-w-16 flex-1 outline-none", className)}
      {...props}
    />
  );
}
