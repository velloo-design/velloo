/**
 * Codegen lowering tables — the Tailwind class strings each lowered helper
 * emits, mirroring what the component applies at runtime. Data-only mirrors:
 * the literals stay duplicated in the co-located `.tsx` components because
 * the server's Tailwind JIT scans only `.tsx` files for class candidates and
 * would not see strings that live only in this `.ts` module.
 *
 * The typography ladder is the exception, and the model for retiring the rest:
 * `headingClasses` / `textClasses` in `@velloo/schema/typeset` are called by the
 * component AND by codegen, because the generated `@source inline(...)` safelist
 * makes the JIT see those utilities without scanning a literal.
 */

// Keep in sync with ./placeholder.tsx (`ASPECT_CLASS`).
export const PLACEHOLDER_ASPECT_CLASS: Record<string, string> = {
  "1/1": "aspect-square",
  "4/3": "aspect-[4/3]",
  "3/4": "aspect-[3/4]",
  "16/9": "aspect-video",
  "21/9": "aspect-[21/9]",
};

// Avatar size ladder — keep in sync with ./placeholder.tsx (`AVATAR_SIZE_CLASS`).
export const PLACEHOLDER_AVATAR_SIZE_CLASS: Record<string, string> = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-base",
  xl: "size-20 text-lg",
};

// Keep in sync with packages/provider-none/src/components.tsx (Stack/Container
// live there, not here — these tables ride along so codegen has one home for
// every lowered-primitive class map).
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

// The no-library primitives that style themselves rather than deferring to a
// className — keep in sync with packages/provider-none/src/components.tsx
// (Card/Button/Input). Their `style`-channel counterparts live in codegen's
// velloo-primitives.ts, mirroring components-inline.tsx.
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
