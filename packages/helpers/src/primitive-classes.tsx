/**
 * The class tables the no-library primitives (`@velloo/provider-none`'s
 * Stack, Container, Card, Button, Input) apply, shared with codegen's
 * lowering of the same primitives so the emitted classes are the rendered
 * ones by construction.
 *
 * A `.tsx` module although it holds no JSX: the server's Tailwind JIT scans
 * only `.tsx` files for class candidates, and these literals are the only
 * place the utilities appear once the components import them.
 */

export const STACK_ALIGN_CLASS: Record<string, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};
export const STACK_JUSTIFY_CLASS: Record<string, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
};
export const CONTAINER_WIDTH_CLASS: Record<string, string> = {
  sm: "max-w-screen-sm",
  md: "max-w-screen-md",
  lg: "max-w-screen-lg",
  xl: "max-w-screen-xl",
  full: "max-w-full",
};

export const CARD_CLASS =
  "rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm";
export const BUTTON_BASE_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2";
export const BUTTON_VARIANT_CLASS: Record<string, string> = {
  default: "bg-foreground text-background hover:bg-foreground/90",
  ghost: "bg-transparent text-foreground hover:bg-muted",
  outline: "bg-transparent text-foreground border border-border hover:bg-muted",
};
export const INPUT_CLASS =
  "block w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2";
