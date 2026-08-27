// Velloo-owned typography primitive — no shadcn equivalent exists.
import * as React from "react";
import { cn } from "./cn.ts";

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Heading level 1–6. Maps to h1..h6. */
  level?: 1 | 2 | 3 | 4 | 5 | 6;
}

// Visible size ladder per heading level. Bumped up a notch from the
// initial (h1: text-4xl) so `level: 5` still clearly reads as a heading
// next to regular Text (which is text-base); h1 actually shouts. Weight
// also steps down with level so the hierarchy is felt, not just measured.
const sizeByLevel: Record<NonNullable<HeadingProps["level"]>, string> = {
  1: "text-5xl font-bold tracking-tight leading-tight",
  2: "text-4xl font-bold tracking-tight leading-tight",
  3: "text-3xl font-semibold tracking-tight",
  4: "text-2xl font-semibold tracking-tight",
  5: "text-xl font-semibold tracking-tight",
  6: "text-lg font-semibold tracking-tight",
};

export const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ level = 1, className, ...props }, ref) => {
    const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    return <Tag ref={ref} className={cn(sizeByLevel[level], className)} {...props} />;
  },
);
Heading.displayName = "Heading";
