// Velloo-owned long-form content region.
//
// `typeset` is velloo CSS, not a Tailwind utility — `themeToCss` ships it on
// every channel — so Prose lives here in the framework-neutral helpers rather
// than in the shadcn provider. A MUI, Ant Design, Chakra, or no-framework
// folder gets the same behavior from the same class.
//
// It exists to make the common case declarative: long-form content is a
// *region* with a rhythm, not a stack of individually-classed blocks. Inside
// one, headings, paragraphs, lists, quotes, code, and tables all pick up the
// typeset's proportions and vertical spacing automatically.

import type * as React from "react";
import { createElement } from "react";
import { cn } from "./cn.ts";

export interface ProseProps extends React.ComponentProps<"div"> {
  /**
   * A named typeset from the theme (`set_typeset`). Omitted uses the folder
   * baseline. The class is emitted unconditionally so a preset added to the
   * theme later starts applying without touching the screen.
   */
  preset?: string;
  /** HTML tag to render. Defaults to `div`; `article` / `section` are common. */
  as?: string;
}

const TAG = /^[a-z][a-z0-9]*$/;
const PRESET = /^[A-Za-z0-9_-]+$/;

export function Prose({ preset, as, className, ...props }: ProseProps) {
  const tag = typeof as === "string" && TAG.test(as) ? as : "div";
  // A preset name reaches CSS as a class, so reject anything not ident-shaped
  // rather than emitting it.
  const presetClass =
    typeof preset === "string" && PRESET.test(preset) ? `typeset-${preset}` : undefined;
  return createElement(tag, {
    "data-slot": "prose",
    className: cn("typeset", presetClass, className),
    ...props,
  });
}
