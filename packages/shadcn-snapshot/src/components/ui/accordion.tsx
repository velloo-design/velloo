// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/accordion).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
// Canvas-safe: an accordion with no `value`/`defaultValue` opens itself, so a
// design that never receives a click still shows its content styling. Designs
// that set either prop keep their explicit state.
"use client";

import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import type * as React from "react";
import { Children, isValidElement, type ReactNode } from "react";

import { cn } from "../../lib/utils.ts";

function itemValues(children: ReactNode): string[] {
  const values: string[] = [];
  for (const child of Children.toArray(children)) {
    if (!isValidElement<{ value?: unknown }>(child)) continue;
    const { value } = child.props;
    if (typeof value === "string") values.push(value);
  }
  return values;
}

/**
 * Radix's `type: "single" | "multiple"` discriminates the whole props union —
 * `value` changes shape with it — which is user-hostile to thread through MCP.
 * The wrapper takes a permissive passthrough instead: a design-mode accordion
 * only has to render.
 */
// biome-ignore lint/suspicious/noExplicitAny: discriminated radix props are user-hostile in design mode
export function Accordion({ className, type, ...props }: any) {
  const classes = cn("flex w-full flex-col", className);
  const resolvedType = type === "multiple" ? "multiple" : "single";

  // Nothing on the canvas is clickable, so an accordion left in its initial
  // state would show every item collapsed and none of the content styling. Open
  // what the type allows — every item when multiple, the first when single.
  const values = props.value || props.defaultValue ? undefined : itemValues(props.children);
  const defaultValue =
    values === undefined || values.length === 0
      ? undefined
      : resolvedType === "multiple"
        ? values
        : values[0];

  return (
    <AccordionPrimitive.Root
      type={resolvedType}
      {...(resolvedType === "single" ? { collapsible: true } : {})}
      data-slot="accordion"
      className={classes}
      {...props}
      {...(defaultValue === undefined ? {} : { defaultValue })}
    />
  );
}

export function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("not-last:border-b", className)}
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
          "group/accordion-trigger relative flex flex-1 items-start justify-between rounded-lg border border-transparent py-2.5 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:after:border-ring disabled:pointer-events-none disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:text-muted-foreground",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon
          data-slot="accordion-trigger-icon"
          className="pointer-events-none shrink-0 group-aria-expanded/accordion-trigger:hidden"
        />
        <ChevronUpIcon
          data-slot="accordion-trigger-icon"
          className="pointer-events-none hidden shrink-0 group-aria-expanded/accordion-trigger:inline"
        />
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
      className="overflow-hidden text-sm data-open:animate-accordion-down data-closed:animate-accordion-up"
      {...props}
    >
      <div
        className={cn(
          "h-(--radix-accordion-content-height) pt-0 pb-2.5 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
          className,
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Content>
  );
}
