// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/direction).
// Design-mode fork for the Velloo canvas — not the shadcn the IDE chrome renders.
// Regenerate with `bun run vendor` — the pipeline is scripts/vendor-shadcn/.
"use client";

import { Direction } from "radix-ui";
import type * as React from "react";

function DirectionProvider({
  dir,
  direction,
  children,
}: React.ComponentProps<typeof Direction.DirectionProvider> & {
  direction?: React.ComponentProps<typeof Direction.DirectionProvider>["dir"];
}) {
  return (
    <Direction.DirectionProvider dir={direction ?? dir}>{children}</Direction.DirectionProvider>
  );
}

const useDirection = Direction.useDirection;

export { DirectionProvider, useDirection };
