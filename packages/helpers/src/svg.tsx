// Velloo-owned helper. Inline SVG that takes its content via the `content`
// prop (markup string) or via children (full JSX). Used for hero
// illustrations, decorative shapes, brand marks — anywhere the static
// design needs custom vector art without re-creating a real `<svg>` tree
// node-by-node.
//
// Codegen emits this as `<svg dangerouslySetInnerHTML={{ __html: ... }}>`
// when `content` is set, or a regular `<svg>{children}</svg>` otherwise.

import { sanitizeSvgMarkup } from "@velloo/schema/svg-sanitize";
import type * as React from "react";
import { cn } from "./cn.ts";

export interface SVGProps extends Omit<React.SVGAttributes<SVGSVGElement>, "content"> {
  /**
   * Inline SVG markup. Pass the contents *inside* the outer `<svg>` —
   * the wrapper element handles viewBox / xmlns. Wins over `children`.
   */
  content?: string;
  /**
   * viewBox for the wrapper svg. Defaults to "0 0 24 24" so single-glyph
   * paths line up; override for full-bleed illustrations.
   */
  viewBox?: string;
  /**
   * The fill / currentColor source. Defaults to "currentColor" so the
   * SVG inherits the parent's text color and theme-flips correctly.
   */
  color?: "currentColor" | "primary" | "accent" | "muted" | string;
}

const COLOR_CLASS: Record<string, string> = {
  primary: "text-primary",
  accent: "text-accent",
  muted: "text-muted-foreground",
};

export function SVG({
  content,
  viewBox = "0 0 24 24",
  color = "currentColor",
  className,
  children,
  ...rest
}: SVGProps) {
  const colorClass = COLOR_CLASS[color] ?? "";
  const props = {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox,
    fill: color === "currentColor" ? "currentColor" : undefined,
    "data-slot": "svg",
    className: cn("inline-block", colorClass, className),
    ...rest,
  };

  if (content) {
    // biome-ignore lint/security/noDangerouslySetInnerHtml: this is the whole point of the SVG helper
    return <svg {...props} dangerouslySetInnerHTML={{ __html: sanitizeSvgMarkup(content) }} />;
  }
  // biome-ignore lint/a11y/noSvgWithoutTitle: consumer supplies title via children when needed
  return <svg {...props}>{children}</svg>;
}
