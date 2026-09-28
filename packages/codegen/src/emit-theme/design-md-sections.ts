/**
 * The section vocabulary of Google Labs' `DESIGN.md`, in one place.
 *
 * Both directions need it: the emitter writes these headings in this order,
 * and the reviewer path reads a stored guidance document back out of them. A
 * second copy would drift, and the failure would be silent — a heading that
 * stops matching does not error, it just returns nothing, and the prose it
 * guards is exactly the part no token can carry.
 */

/** The spec's section order. Emitted `##` headings follow it exactly. */
export const DESIGN_MD_SECTIONS = [
  "Overview",
  "Colors",
  "Typography",
  "Layout",
  "Elevation & Depth",
  "Shapes",
  "Components",
  "Do's and Don'ts",
] as const;

export type DesignMdSection = (typeof DESIGN_MD_SECTIONS)[number];

/**
 * Headings the spec accepts for a section besides its canonical name. Without
 * these, reading a real file silently misses its most valuable prose: the
 * examples Google ships open with `## Brand & Style`, not `## Overview`.
 */
const SECTION_ALIASES: Partial<Record<DesignMdSection, readonly string[]>> = {
  Overview: ["Brand & Style"],
  Layout: ["Layout & Spacing"],
  "Elevation & Depth": ["Elevation"],
};

/**
 * Compare headings the way a reader would, not the way a byte comparison does.
 * `Do's and Don'ts` is hand-written far more often than it is generated, so it
 * arrives with a curly apostrophe, with none at all, or lower-cased — and a
 * miss here means the reviewer reports no rules rather than reporting an
 * unreadable heading.
 */
function normalizeHeading(heading: string): string {
  return heading
    .replace(/[‘’ʼ'']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

/**
 * Split a markdown document into its `##` sections, keyed by heading. The one
 * scanner for DESIGN.md prose: reading a document, sniffing whether a file is
 * one, and emitting one back all go through it, so a section edited by hand
 * comes back in the same place under the same heading. Text before the first
 * `##` is kept under the empty key so nothing is lost.
 */
export function markdownSections(markdown: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Line by line rather than one split regex: the file is the repo's, and a
  // heading pattern with a lazy capture beside optional trailing whitespace
  // backtracks polynomially on a long run of tabs.
  let heading = "";
  let body: string[] = [];
  const flush = () => {
    const text = body.join("\n").trim();
    // A duplicate heading is a lint error in DESIGN.md itself; keep the first
    // so a malformed file cannot silently drop the section that came before.
    if (heading === "" ? text !== "" : out[heading] === undefined) out[heading] = text;
  };
  for (const line of markdown.split(/\r?\n/)) {
    const title = sectionHeading(line);
    if (title === null) {
      body.push(line);
      continue;
    }
    flush();
    heading = title;
    body = [];
  }
  flush();
  return out;
}

/** The heading of a `## Heading` line, or null for any other line (`###` included). */
function sectionHeading(line: string): string | null {
  if (!line.startsWith("##") || (line[2] !== " " && line[2] !== "\t")) return null;
  const title = line.slice(3).trim();
  return title === "" ? null : title;
}

/**
 * The text stored under a section, under whichever heading it was written.
 * `sections` is a heading→body map, as {@link markdownSections} produces.
 */
export function designMdSection(
  sections: Record<string, string> | undefined,
  section: DesignMdSection,
): string | undefined {
  if (!sections) return undefined;
  // Canonical name first, then each alias in turn — NOT document order. A
  // file that carries both `## Overview` and `## Brand & Style` means the
  // canonical one; scanning the document instead lets whichever was written
  // first win, which is a coin flip.
  const normalized = Object.entries(sections).map(
    ([heading, body]) => [normalizeHeading(heading), body] as const,
  );
  for (const candidate of [section, ...(SECTION_ALIASES[section] ?? [])]) {
    const wanted = normalizeHeading(candidate);
    for (const [heading, body] of normalized) {
      if (heading !== wanted) continue;
      if (body === undefined || body.trim() === "") continue;
      return body;
    }
  }
  return undefined;
}
