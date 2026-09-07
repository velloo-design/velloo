/**
 * App stacks the init wizard can record. The choice only affects codegen's
 * import prefix — `emit_code` mentions components as `<alias>/button` — so
 * the emitted IR drops into the user's app without a path edit. Next/Vite/
 * Astro conventionally alias `@` to the source root; Remix / React Router
 * templates alias `~`.
 */

import type { Framework } from "../scan/types.ts";

export interface Stack {
  id: string;
  label: string;
  /** codegen.componentsAlias persisted to `.design/config.json`. */
  alias: string;
}

const STACKS: Stack[] = [
  { id: "nextjs", label: "Next.js", alias: "@/components/ui" },
  { id: "vite", label: "Vite (React)", alias: "@/components/ui" },
  { id: "astro", label: "Astro", alias: "@/components/ui" },
  { id: "remix", label: "Remix / React Router", alias: "~/components/ui" },
];

/**
 * The stack a folder gets when nothing was detected. Its `@/components/ui`
 * alias is the convention three of the four stacks share, so it's the safest
 * guess — and the one the wizard uses instead of asking.
 */
export const DEFAULT_STACK_ID = "vite";

/**
 * Map a scanned host framework onto a stack, so the wizard can skip the
 * question entirely. Only Remix/React Router differs in alias; everything
 * else lands on `@/components/ui`.
 */
export function stackForFramework(framework: Framework | undefined): string {
  switch (framework) {
    case "next-app":
    case "next-pages":
      return "nextjs";
    case "react-router":
      return "remix";
    case "astro":
      return "astro";
    default:
      return DEFAULT_STACK_ID;
  }
}

export function stackById(id: string | undefined): Stack | undefined {
  return id ? STACKS.find((s) => s.id === id) : undefined;
}

export function isValidStack(id: string): boolean {
  return STACKS.some((s) => s.id === id);
}
