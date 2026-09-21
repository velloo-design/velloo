import { join } from "node:path";
import { designMdSection } from "@velloo/codegen";
import { ok, type Result } from "@velloo/result";
import { type DesignFolder, GUIDANCE_FILENAME } from "../design-folder.ts";
import { writeText } from "../fs.ts";
import type { ThemeError } from "./errors.ts";

export interface GuidanceResult {
  markdown: string;
  sections: string[];
  bytes: number;
}

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

/**
 * Read or replace the folder's design guidance — the prose half of a design
 * system, which no token can carry: what the brand should feel like, and the
 * do's and don'ts a screen is supposed to honour.
 *
 * Stored as plain markdown rather than a parsed structure on purpose. Its value
 * is that an agent reads it, and DESIGN.md's own section order is enough shape.
 */
export async function setGuidance(
  folder: DesignFolder,
  markdown: string,
): Promise<Result<GuidanceResult, ThemeError>> {
  const text = markdown.trim() === "" ? "" : `${markdown.trimEnd()}\n`;
  await writeText(join(folder.root, GUIDANCE_FILENAME), text);
  folder.guidance = text;
  return ok({
    markdown: text,
    sections: Object.keys(guidanceSections(text)).filter((s) => s !== ""),
    bytes: Buffer.byteLength(text, "utf8"),
  });
}

/** Whether a rule tells you to do something or not to. */
type GuidanceRuleKind = "do" | "dont" | "unspecified";

export interface GuidanceRule {
  /** Position in the section, 1-based, so a finding can cite which rule. */
  index: number;
  kind: GuidanceRuleKind;
  /** The rule exactly as written, markdown and all, for quoting back verbatim. */
  text: string;
}

/** Leading emphasis and list markers, for classifying without altering `text`. */
const stripMarkup = (s: string): string => s.replace(/^[\s*_`>]+/, "");

const DONT = /^(don'?t\b|do not\b|never\b|avoid\b|no\b)/i;
const DO = /^(do\b|always\b|prefer\b|use\b|keep\b|ensure\b|make sure\b)/i;

function classify(text: string): GuidanceRuleKind {
  const bare = stripMarkup(text);
  // Order matters: "Don't" starts with "Do".
  if (DONT.test(bare)) return "dont";
  if (DO.test(bare)) return "do";
  return "unspecified";
}

/**
 * The folder's stated design rules: the list under DESIGN.md's "Do's and
 * Don'ts", split into individually quotable items.
 *
 * Parsed here rather than left to the reviewing agent for two reasons. The
 * heading is hand-written far more often than generated, so it arrives with a
 * curly apostrophe or none at all and a naive match silently finds nothing;
 * and a finding is only worth trusting if it quotes the user's own words, which
 * is easier to hold an agent to when the words arrive as a list it did not
 * transcribe.
 *
 * Returns [] when the folder states no rules — which is not the same as the
 * screens being fine, and callers should say so rather than implying a pass.
 */
export function guidanceRules(markdown: string): GuidanceRule[] {
  const section = designMdSection(guidanceSections(markdown), "Do's and Don'ts");
  if (section === undefined) return [];

  const items = [
    ...section.matchAll(
      /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(.+(?:\n(?![ \t]*(?:[-*+]|\d+[.)])[ \t]|[ \t]*$).*)*)/gm,
    ),
  ]
    .map((m) => (m[1] as string).trim())
    .filter((t) => t !== "");

  // A section written as prose rather than a list still states rules; treat
  // each paragraph as one rather than returning nothing.
  const source =
    items.length > 0
      ? items
      : section
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter((p) => p !== "");

  return source.map((text, i) => ({ index: i + 1, kind: classify(text), text }));
}
