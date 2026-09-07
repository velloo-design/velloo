// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/collapsible).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
// Canvas-safe: nothing on the canvas is clickable, so a collapsible left at its
// default would render as an unopenable header. With neither `open` nor
// `defaultOpen` set, the content starts open so the design is previewable.
"use client";

import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import type * as React from "react";

export function Collapsible({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  const designOpen = props.open === undefined && props.defaultOpen === undefined;
  return (
    <CollapsiblePrimitive.Root
      data-slot="collapsible"
      {...(designOpen ? { defaultOpen: true } : {})}
      {...props}
    />
  );
}

export function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return <CollapsiblePrimitive.CollapsibleTrigger data-slot="collapsible-trigger" {...props} />;
}

export function CollapsibleContent({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return <CollapsiblePrimitive.CollapsibleContent data-slot="collapsible-content" {...props} />;
}
