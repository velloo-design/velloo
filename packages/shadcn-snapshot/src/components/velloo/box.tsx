// Velloo-owned generic container. Designs are mostly layout: before Box
// existed every flex/grid wrapper was a Card with its chrome reset
// ("ring-0 shadow-none bg-transparent rounded-none p-0"), which bloated
// trees and invited styling accidents (Card's overflow-hidden clipping
// children). Box is a plain div: no chrome, no padding, no surprises —
// className is the whole API. Codegen lowers it to `<div>`.
import type * as React from "react";
import { cn } from "../../lib/utils.ts";

export function Box({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="box" className={cn(className)} {...props} />;
}
