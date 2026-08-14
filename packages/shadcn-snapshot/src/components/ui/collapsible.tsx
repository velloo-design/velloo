// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/collapsible).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
"use client";

import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import type * as React from "react";

/**
 * Canvas-safe: when neither `open` nor `defaultOpen` is passed,
 * forcibly render the content open so designs are previewable.
 */
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
