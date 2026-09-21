/**
 * Split a guidance document into its `##` sections, keyed by heading.
 *
 * The same scanner runs on the way in (an imported DESIGN.md body) and on the
 * way out (emitting one), which is what makes the round trip stable: a section
 * the user edited by hand comes back in the same place under the same heading.
 * Text before the first `##` is kept under the empty key so nothing is lost.
 */
export function guidanceSections(markdown: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = markdown.split(/^##[ \t]+(.+?)[ \t]*$/gm);
  const preamble = parts[0]?.trim();
  if (preamble) out[""] = preamble;
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i]?.trim();
    if (heading === undefined || heading === "") continue;
    // A duplicate heading is a lint error in DESIGN.md itself; keep the first
    // so a malformed file cannot silently drop the section that came before.
    if (out[heading] === undefined) out[heading] = (parts[i + 1] ?? "").trim();
  }
  return out;
}
