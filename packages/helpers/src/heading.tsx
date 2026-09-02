// Velloo-owned typography primitive — no shadcn equivalent exists.
import { headingClasses } from "@velloo/schema/typeset";
import * as React from "react";
import { cn } from "./cn.ts";

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /**
   * Heading level 1–6. Picks both the HTML tag and the rung of the theme's type
   * ladder, so `level` follows the folder's typeset rather than a fixed size.
   */
  level?: 1 | 2 | 3 | 4 | 5 | 6;
}

export const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ level = 1, className, ...props }, ref) => {
    const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    return <Tag ref={ref} className={cn(headingClasses(level), className)} {...props} />;
  },
);
Heading.displayName = "Heading";
