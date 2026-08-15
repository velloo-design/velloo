import { clsx } from "clsx";
import * as React from "react";

/**
 * The no-library provider's primitives — thin wrappers over plain HTML
 * elements. Anything that needs visual styling does it through Tailwind
 * classes the user (or agent) supplies via the `className` prop. No
 * portals, no providers, no internal state. This is intentionally the
 * lowest-rope primitive set: ideal for throwaway prototypes, designs
 * that haven't picked a UI library yet, and as the proof that the
 * `ComponentProvider` abstraction works at the trivial end of the
 * spectrum.
 */

interface DivProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Box = React.forwardRef<HTMLDivElement, DivProps>(({ className, ...rest }, ref) => (
  <div ref={ref} className={clsx(className)} {...rest} />
));
Box.displayName = "Box";

export interface StackProps extends DivProps {
  /** Layout direction. Defaults to "col" (flex-column). */
  direction?: "row" | "col";
  /** Tailwind gap scale (2, 4, 6, …). Defaults to 4. */
  gap?: number;
  /** Cross-axis alignment. */
  align?: "start" | "center" | "end" | "stretch";
  /** Main-axis justification. */
  justify?: "start" | "center" | "end" | "between" | "around";
}

const alignClass: Record<NonNullable<StackProps["align"]>, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};
const justifyClass: Record<NonNullable<StackProps["justify"]>, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
};

export const Stack = React.forwardRef<HTMLDivElement, StackProps>(
  ({ direction = "col", gap = 4, align, justify, className, ...rest }, ref) => (
    <div
      ref={ref}
      className={clsx(
        "flex",
        direction === "row" ? "flex-row" : "flex-col",
        `gap-${gap}`,
        align ? alignClass[align] : undefined,
        justify ? justifyClass[justify] : undefined,
        className,
      )}
      {...rest}
    />
  ),
);
Stack.displayName = "Stack";

export interface ContainerProps extends DivProps {
  /** Max-width preset. Defaults to "md". */
  size?: "sm" | "md" | "lg" | "xl" | "full";
}

const containerWidth: Record<NonNullable<ContainerProps["size"]>, string> = {
  sm: "max-w-screen-sm",
  md: "max-w-screen-md",
  lg: "max-w-screen-lg",
  xl: "max-w-screen-xl",
  full: "max-w-full",
};

export const Container = React.forwardRef<HTMLDivElement, ContainerProps>(
  ({ size = "md", className, ...rest }, ref) => (
    <div
      ref={ref}
      className={clsx("mx-auto w-full px-4", containerWidth[size], className)}
      {...rest}
    />
  ),
);
Container.displayName = "Container";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost" | "outline";
}

const buttonVariant: Record<NonNullable<ButtonProps["variant"]>, string> = {
  default: "bg-foreground text-background hover:bg-foreground/90",
  ghost: "bg-transparent text-foreground hover:bg-muted",
  outline: "bg-transparent text-foreground border border-border hover:bg-muted",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", className, type, ...rest }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
        buttonVariant[variant],
        className,
      )}
      {...rest}
    />
  ),
);
Button.displayName = "Button";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", value, onChange, ...rest }, ref) => {
    // Same canvas-safe pattern as the shadcn snapshot's Input: if a
    // static `value` is supplied without `onChange`, switch to
    // `readOnly` so React doesn't warn about uncontrolled→controlled.
    const isStatic = value !== undefined && onChange === undefined;
    return (
      <input
        ref={ref}
        type={type}
        value={value}
        onChange={onChange}
        readOnly={isStatic || rest.readOnly}
        className={clsx(
          "block w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
          "placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2",
          className,
        )}
        {...rest}
      />
    );
  },
);
Input.displayName = "Input";

export interface CardProps extends DivProps {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(({ className, ...rest }, ref) => (
  <div
    ref={ref}
    className={clsx(
      "rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm",
      className,
    )}
    {...rest}
  />
));
Card.displayName = "Card";
