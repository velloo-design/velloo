/**
 * App stacks the init wizard can record. The choice only affects codegen's
 * import prefix — `emit_code` mentions components as `<alias>/button` — so
 * the emitted IR drops into the user's app without a path edit. Next/Vite/
 * Astro conventionally alias `@` to the source root; Remix / React Router
 * templates alias `~`.
 */

export interface Stack {
  id: string;
  label: string;
  /** codegen.componentsAlias persisted to `.design/config.json`. */
  alias: string;
}

export const STACKS: Stack[] = [
  { id: "nextjs", label: "Next.js", alias: "@/components/ui" },
  { id: "vite", label: "Vite (React)", alias: "@/components/ui" },
  { id: "astro", label: "Astro", alias: "@/components/ui" },
  { id: "remix", label: "Remix / React Router", alias: "~/components/ui" },
];

export function stackById(id: string | undefined): Stack | undefined {
  return id ? STACKS.find((s) => s.id === id) : undefined;
}

export function isValidStack(id: string): boolean {
  return STACKS.some((s) => s.id === id);
}
