// Velloo-owned typography primitive — no shadcn equivalent exists.
import { textClasses } from "@velloo/schema/typeset";
import * as React from "react";
import { cn } from "./cn.ts";

export interface TextProps extends React.HTMLAttributes<HTMLElement> {
  /** Visual weight. Selects a rung of the theme's type ladder plus a tone. */
  variant?: "default" | "muted" | "small" | "lead";
}

/**
 * True beneath a `Text`. A paragraph cannot hold a paragraph: an HTML parser
 * ends the outer `<p>` where the inner one starts, so markup that is rendered
 * on the server and parsed again (a screenshot, a comparison) lays the inner
 * text out as a sibling, while the same tree mounted on the client keeps it
 * nested. A `Text` inside a `Text` is a run of that paragraph, so it renders
 * the element a run is — and every path draws the same line.
 */
export const TextRunContext = React.createContext(false);

/** The element a `Text` renders: a paragraph, or a run inside one. */
export function textTag(run: boolean): "p" | "span" {
  return run ? "span" : "p";
}

export const Text = React.forwardRef<HTMLElement, TextProps>(
  ({ variant = "default", className, ...props }, ref) => {
    const run = React.useContext(TextRunContext);
    return (
      <TextRunContext.Provider value={true}>
        {React.createElement(textTag(run), {
          ref,
          className: cn(textClasses(variant), className),
          ...props,
        })}
      </TextRunContext.Provider>
    );
  },
);
Text.displayName = "Text";
