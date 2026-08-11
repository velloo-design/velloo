// Velloo-owned typography primitive — no shadcn equivalent exists.
import * as React from "react";
import { cn } from "../../lib/utils.ts";

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Heading level 1–6. Maps to h1..h6. */
  level?: 1 | 2 | 3 | 4 | 5 | 6;
}

const sizeByLevel: Record<NonNullable<HeadingProps["level"]>, string> = {
  1: "text-4xl font-semibold tracking-tight",
  2: "text-3xl font-semibold tracking-tight",
  3: "text-2xl font-semibold tracking-tight",
  4: "text-xl font-semibold tracking-tight",
  5: "text-lg font-semibold tracking-tight",
  6: "text-base font-semibold tracking-tight",
};

export const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ level = 1, className, ...props }, ref) => {
    const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    return <Tag ref={ref} className={cn(sizeByLevel[level], className)} {...props} />;
  },
);
Heading.displayName = "Heading";
