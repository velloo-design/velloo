// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/aspect-ratio).
// Design-mode fork for the Velloo canvas — not the shadcn the IDE chrome renders.
// Regenerate with `bun run vendor` — the pipeline is scripts/vendor-shadcn/.
"use client";

import { AspectRatio as AspectRatioPrimitive } from "radix-ui";

function AspectRatio({ ...props }: React.ComponentProps<typeof AspectRatioPrimitive.Root>) {
  return <AspectRatioPrimitive.Root data-slot="aspect-ratio" {...props} />;
}

export { AspectRatio };
