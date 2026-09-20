import type { ReactNode } from "react";

export interface BadgeProps {
  /** Visual weight. @default "solid" */
  variant?: "solid" | "outline";
  children?: ReactNode;
}

export function Badge({ variant = "solid", children }: BadgeProps) {
  return (
    <span data-variant={variant} style={{ padding: "2px 8px", borderRadius: 999 }}>
      {children}
    </span>
  );
}
