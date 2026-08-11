// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/input)
import * as React from "react";
import { cn } from "../../lib/utils.ts";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

/**
 * The data-*-ignore attributes defeat LastPass / 1Password / Bitwarden so they
 * don't decorate Velloo design inputs with their UI. `autoComplete="off"` is the
 * standard browser hint. All can be overridden by passing the prop explicitly.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, autoComplete = "off", ...props }, ref) => (
    <input
      type={type}
      autoComplete={autoComplete}
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      data-form-type="other"
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";
