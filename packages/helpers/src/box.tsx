// Velloo-owned generic container. Designs are mostly layout: before Box
// existed every flex/grid wrapper was a Card with its chrome reset
// ("ring-0 shadow-none bg-transparent rounded-none p-0"), which bloated
// trees and invited styling accidents (Card's overflow-hidden clipping
// children). Box is a plain div: no chrome, no padding, no surprises —
// className is the whole API. Codegen lowers it to `<as ?? div>`.

import type * as React from "react";
import { createElement } from "react";
import { cn } from "./cn.ts";

/**
 * An element name: an HTML tag, or one of SVG's camelCase ones
 * (`linearGradient`, `clipPath`). Shared by everything that has to agree on
 * what `as` may hold — compose's lowering, each `Box`, and codegen — because a
 * tag one of them accepts and another doesn't renders as a `div`.
 */
export const ELEMENT_TAG = /^[a-z][a-zA-Z0-9]*$/;

// Restrict `as` to an element name. Anything else (a component reference, an
// injection attempt) falls back to div. Rendering the real tag means inline
// elements (span/strong/a/…) get their natural inline display from the UA
// stylesheet, instead of a div's block stacking inline runs.
export function Box({ as, className, ...props }: React.ComponentProps<"div"> & { as?: string }) {
  const tag = typeof as === "string" && ELEMENT_TAG.test(as) ? as : "div";
  return createElement(tag, { "data-slot": "box", className: cn(className), ...props });
}
