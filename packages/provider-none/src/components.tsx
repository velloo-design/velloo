import {
  BUTTON_BASE_CLASS,
  BUTTON_VARIANT_CLASS,
  CARD_CLASS,
  CONTAINER_WIDTH_CLASS,
  INPUT_CLASS,
  STACK_ALIGN_CLASS,
  STACK_JUSTIFY_CLASS,
} from "@velloo/helpers";
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

/** `as` takes a lowercase HTML tag only — anything else renders the div. */
export const BOX_TAG = /^[a-z][a-z0-9]*$/;

export const Box = React.forwardRef<HTMLDivElement, DivProps & { as?: string }>(
  ({ as, className, ...rest }, ref) =>
    React.createElement(typeof as === "string" && BOX_TAG.test(as) ? as : "div", {
      ref,
      className: clsx(className),
      ...rest,
    }),
);
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

export const Stack = React.forwardRef<HTMLDivElement, StackProps>(
  ({ direction = "col", gap = 4, align, justify, className, ...rest }, ref) => (
    <div
      ref={ref}
      className={clsx(
        "flex",
        direction === "row" ? "flex-row" : "flex-col",
        `gap-${gap}`,
        align ? STACK_ALIGN_CLASS[align] : undefined,
        justify ? STACK_JUSTIFY_CLASS[justify] : undefined,
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

export const Container = React.forwardRef<HTMLDivElement, ContainerProps>(
  ({ size = "md", className, ...rest }, ref) => (
    <div
      ref={ref}
      className={clsx("mx-auto w-full px-4", CONTAINER_WIDTH_CLASS[size], className)}
      {...rest}
    />
  ),
);
Container.displayName = "Container";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost" | "outline";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", className, type, ...rest }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={clsx(BUTTON_BASE_CLASS, BUTTON_VARIANT_CLASS[variant], className)}
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
        className={clsx(INPUT_CLASS, className)}
        {...rest}
      />
    );
  },
);
Input.displayName = "Input";

export interface CardProps extends DivProps {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(({ className, ...rest }, ref) => (
  <div ref={ref} className={clsx(CARD_CLASS, className)} {...rest} />
));
Card.displayName = "Card";
