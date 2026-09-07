// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/aspect-ratio).
// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.
// Regenerate with `bun run vendor` — do not hand-edit unless you are adding a
// canvas adaptation, in which case add the id to vendor.ts's ADAPTED set.
"use client";

import { AspectRatio as AspectRatioPrimitive } from "radix-ui";

function AspectRatio({ ...props }: React.ComponentProps<typeof AspectRatioPrimitive.Root>) {
  return <AspectRatioPrimitive.Root data-slot="aspect-ratio" {...props} />;
}

export { AspectRatio };
