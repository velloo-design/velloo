import { headingInlineStyle, textInlineStyle } from "@velloo/schema/typeset";
import * as React from "react";
import type { ButtonProps, ContainerProps, InputProps, StackProps } from "./components.tsx";

/**
 * Inline-styled variants of the no-library primitives, for a `none`-CSS folder
 * (`config.styling.framework === "none"`). Identical props + structural defaults
 * to the Tailwind set in `components.tsx`, but every default is a plain `style`
 * object instead of a Tailwind class — so they paint with the JIT off. Theme
 * tokens reach them as the CSS variables `themeToCss` injects
 * (`var(--color-foreground)`, `var(--radius)`, …), so a `none/none` folder still
 * themes. The node's authored `style` (set via `update_props`) merges last and wins.
 *
 * Typography is the same story one level deeper: Heading/Text reference the
 * typeset's `var(--text-*)` / `var(--leading-*)` tokens rather than hardcoded
 * rem values, so a `none/none` folder's type follows its typeset — and moves
 * live when one changes — exactly like every other channel.
 */

/** Merge structural defaults with the node's authored inline style (author wins). */
function merge(
  defaults: React.CSSProperties,
  authored: React.CSSProperties | undefined,
): React.CSSProperties {
  return authored ? { ...defaults, ...authored } : defaults;
}

/** Tailwind's spacing scale is 0.25rem per step (gap-4 ⇒ 1rem). */
const space = (n: number) => `${n * 0.25}rem`;

export const Box = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ style, ...rest }, ref) => <div ref={ref} style={style} {...rest} />,
);
Box.displayName = "Box";

const alignStyle: Record<NonNullable<StackProps["align"]>, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};
const justifyStyle: Record<NonNullable<StackProps["justify"]>, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
};

export const Stack = React.forwardRef<HTMLDivElement, StackProps>(
  ({ direction = "col", gap = 4, align, justify, style, ...rest }, ref) => (
    <div
      ref={ref}
      style={merge(
        {
          display: "flex",
          flexDirection: direction === "row" ? "row" : "column",
          gap: space(gap),
          ...(align ? { alignItems: alignStyle[align] } : {}),
          ...(justify ? { justifyContent: justifyStyle[justify] } : {}),
        },
        style,
      )}
      {...rest}
    />
  ),
);
Stack.displayName = "Stack";

const containerMaxWidth: Record<NonNullable<ContainerProps["size"]>, string> = {
  sm: "640px",
  md: "768px",
  lg: "1024px",
  xl: "1280px",
  full: "100%",
};

export const Container = React.forwardRef<HTMLDivElement, ContainerProps>(
  ({ size = "md", style, ...rest }, ref) => (
    <div
      ref={ref}
      style={merge(
        {
          marginInline: "auto",
          width: "100%",
          paddingInline: "1rem",
          maxWidth: containerMaxWidth[size],
        },
        style,
      )}
      {...rest}
    />
  ),
);
Container.displayName = "Container";

const buttonVariantStyle: Record<NonNullable<ButtonProps["variant"]>, React.CSSProperties> = {
  default: { background: "var(--color-foreground)", color: "var(--color-background)" },
  ghost: { background: "transparent", color: "var(--color-foreground)" },
  outline: {
    background: "transparent",
    color: "var(--color-foreground)",
    border: "1px solid var(--color-border)",
  },
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", type, style, ...rest }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      style={merge(
        {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.5rem",
          borderRadius: "var(--radius)",
          padding: "0.5rem 1rem",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: "pointer",
          ...buttonVariantStyle[variant],
        },
        style,
      )}
      {...rest}
    />
  ),
);
Button.displayName = "Button";

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ type = "text", value, onChange, style, ...rest }, ref) => {
    const isStatic = value !== undefined && onChange === undefined;
    return (
      <input
        ref={ref}
        type={type}
        value={value}
        onChange={onChange}
        readOnly={isStatic || rest.readOnly}
        style={merge(
          {
            display: "block",
            width: "100%",
            borderRadius: "var(--radius)",
            border: "1px solid var(--color-input)",
            background: "var(--color-background)",
            padding: "0.5rem 0.75rem",
            fontSize: "0.875rem",
          },
          style,
        )}
        {...rest}
      />
    );
  },
);
Input.displayName = "Input";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ style, ...rest }, ref) => (
    <div
      ref={ref}
      style={merge(
        {
          borderRadius: "var(--radius)",
          border: "1px solid var(--color-border)",
          background: "var(--color-card)",
          color: "var(--color-card-foreground)",
          padding: "1.5rem",
          boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        },
        style,
      )}
      {...rest}
    />
  ),
);
Card.displayName = "Card";

interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  level?: 1 | 2 | 3 | 4 | 5 | 6;
}

export const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ level = 1, style, ...rest }, ref) => {
    const Tag = `h${level}` as const;
    return <Tag ref={ref} style={merge(headingInlineStyle(level), style)} {...rest} />;
  },
);
Heading.displayName = "Heading";

interface TextProps extends React.HTMLAttributes<HTMLParagraphElement> {
  variant?: "default" | "muted" | "small" | "lead";
}

export const Text = React.forwardRef<HTMLParagraphElement, TextProps>(
  ({ variant = "default", style, ...rest }, ref) => (
    <p ref={ref} style={merge(textInlineStyle(variant), style)} {...rest} />
  ),
);
Text.displayName = "Text";
