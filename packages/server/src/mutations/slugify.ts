/**
 * Turn a human name into a filesystem-safe id stem: lowercase, non-alphanumerics
 * collapsed to `-`, trimmed, capped at 48 chars. Falls back to `fallback` when
 * the input has no usable characters. Shared by the board / screen / snippet /
 * group add-mutations (which differ only in the fallback word).
 */
export function slugify(s: string, fallback: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || fallback
  );
}
