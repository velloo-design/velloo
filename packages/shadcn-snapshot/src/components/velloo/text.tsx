// Velloo-owned typography primitive — no shadcn equivalent exists.
import * as React from "react";
import { cn } from "../../lib/utils.ts";

export interface TextProps extends React.HTMLAttributes<HTMLParagraphElement> {
  /** Visual weight. */
  variant?: "default" | "muted" | "small" | "lead";
}

const variantClasses: Record<NonNullable<TextProps["variant"]>, string> = {
  default: "text-base text-foreground leading-7",
  muted: "text-sm text-muted-foreground",
  small: "text-sm font-medium leading-none",
  lead: "text-xl text-muted-foreground",
};

export const Text = React.forwardRef<HTMLParagraphElement, TextProps>(
  ({ variant = "default", className, ...props }, ref) => (
    <p ref={ref} className={cn(variantClasses[variant], className)} {...props} />
  ),
);
Text.displayName = "Text";
