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
