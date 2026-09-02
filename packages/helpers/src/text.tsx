// Velloo-owned typography primitive — no shadcn equivalent exists.
import { textClasses } from "@velloo/schema/typeset";
import * as React from "react";
import { cn } from "./cn.ts";

export interface TextProps extends React.HTMLAttributes<HTMLParagraphElement> {
  /** Visual weight. Selects a rung of the theme's type ladder plus a tone. */
  variant?: "default" | "muted" | "small" | "lead";
}

export const Text = React.forwardRef<HTMLParagraphElement, TextProps>(
  ({ variant = "default", className, ...props }, ref) => (
    <p ref={ref} className={cn(textClasses(variant), className)} {...props} />
  ),
);
Text.displayName = "Text";
