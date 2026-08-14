// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/accordion).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
"use client";

import { ChevronDown } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";

/**
 * Canvas-safe contract: when no `value`/`defaultValue` is set, the
 * accordion shows everything open in design mode so designers see the
 * styling without clicking each item. Real apps that pass either prop
 * keep their explicit state.
 *
 * Radix's discriminated `type: "single" | "multiple"` makes the props
 * union strict (different `value` shape). The Velloo wrapper relaxes
 * the contract to a single `any`-shaped passthrough so users don't
 * have to thread the right value shape through MCP — design-mode
 * Accordion just needs to render.
 */
// biome-ignore lint/suspicious/noExplicitAny: discriminated radix props are user-hostile in design mode
export function Accordion({ type, ...props }: any) {
  if (type === "multiple") {
    const defaultOpen = !props.value && !props.defaultValue;
    return (
      <AccordionPrimitive.Root
        type="multiple"
        data-slot="accordion"
        {...props}
        {...(defaultOpen ? { defaultValue: ["__all__"] } : {})}
      />
    );
  }
  return (
    <AccordionPrimitive.Root type={type ?? "single"} collapsible data-slot="accordion" {...props} />
  );
}

export function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("border-b last:border-b-0", className)}
      {...props}
    />
  );
}

export function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg]:rotate-180",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDown className="text-muted-foreground pointer-events-none size-4 shrink-0 translate-y-0.5 transition-transform duration-200" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden text-sm"
      {...props}
    >
      <div className={cn("pt-0 pb-4", className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}
