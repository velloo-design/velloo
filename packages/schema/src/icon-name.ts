/**
 * Lucide icon names are PascalCase exports ("SquarePen"), but lucide's
 * own site and most docs present kebab-case ids ("square-pen") — agents
 * pass both. Shared normalizer so the runtime Icon helper, codegen's
 * lucide import resolver, and the server's advisory prop warnings all
 * agree on what resolves.
 */

/** "square-pen" / "square_pen" / "square pen" → "SquarePen". PascalCase input passes through. */
export function pascalizeIconName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") return trimmed;
  if (!/[-_\s]/.test(trimmed)) {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }
  return trimmed
    .split(/[-_\s]+/)
    .filter((part) => part !== "")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
