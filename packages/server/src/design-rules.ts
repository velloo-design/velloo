import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { type DesignMdSection, designMdSection, markdownSections } from "@velloo/codegen";
import { err, ok, type Result } from "@velloo/result";
import type { DesignFolder } from "./design-folder.ts";
import { designSystemDoc, GUIDANCE_FILENAME, readDesignSystemDoc } from "./design-system.ts";
import { writeText } from "./fs.ts";
import { type MutationContext, withConfigLock } from "./mutations/context.ts";
import { badRequest, type MutationError } from "./mutations/errors.ts";

/**
 * A design's rules in words — the half of a design language no token carries.
 *
 * They live in the design system document the folder follows, under the
 * headings Google Labs' DESIGN.md gives them (`Overview`, `Do's and Don'ts`),
 * because that is where the MCP instructions and the reviewer already look.
 * Reading works on any followed document. Writing only ever touches the
 * folder's own `guidance.md`: a repo's `DESIGN.md` is the repo's, and stays
 * read-only here.
 */

export interface DesignRule {
  kind: "do" | "dont";
  /** The rule as written, without its `Do:` / `Don't:` label. */
  text: string;
}

export interface DesignRules {
  /** What the design is going for, in a sentence or two (`## Overview`). */
  intent: string;
  rules: DesignRule[];
}

export interface DesignRulesState extends DesignRules {
  /** The document the rules were read from; null when the folder follows none yet. */
  source: { path: string; writable: boolean } | null;
}

const RULES_SECTION: DesignMdSection = "Do's and Don'ts";
const INTENT_SECTION: DesignMdSection = "Overview";

const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
/** `Do`, `Don't`, `Do not` — bold or not, with or without a colon or dash after. */
const LABEL =
  /^(?:\*\*|__)?(do\s+not|don[’'ʼ]?t|do)(?:\*\*|__)?(?=$|[\s:—–-])\s*[:—–-]?\s*(?:\*\*|__)?\s*/i;
const SUBHEADING = /^\s*(?:#{3,}\s*(.+?)|(?:\*\*|__)(.+?)(?:\*\*|__))\s*:?\s*$/;

function labelKind(label: string): DesignRule["kind"] {
  return /^do$/i.test(label.trim()) ? "do" : "dont";
}

/**
 * Read a `Do's and Don'ts` body into rules. Hand-written sections come in two
 * shapes — every bullet labelled (`- Don't mix…`), or bullets grouped under
 * `### Do` / `### Don't` — so a bullet's own label wins and an unlabelled one
 * takes the subheading it sits under.
 */
export function parseRules(body: string): DesignRule[] {
  const rules: DesignRule[] = [];
  let section: DesignRule["kind"] = "do";
  let open: DesignRule | null = null;
  for (const line of body.split(/\r?\n/)) {
    const bullet = BULLET.exec(line);
    if (bullet) {
      const raw = (bullet[1] ?? "").trim();
      const label = LABEL.exec(raw);
      const text = (label ? raw.slice(label[0].length) : raw).trim();
      open = { kind: label ? labelKind(label[1] ?? "") : section, text };
      if (text !== "") rules.push(open);
      continue;
    }
    const sub = SUBHEADING.exec(line);
    const title = sub?.[1] ?? sub?.[2];
    const titleLabel = title ? LABEL.exec(title.trim()) : null;
    if (title && titleLabel && titleLabel[0].length === title.trim().length) {
      section = labelKind(titleLabel[1] ?? "");
      open = null;
      continue;
    }
    // A wrapped bullet: its indented continuation is still the same rule.
    if (open && /^\s+\S/.test(line)) open.text = `${open.text} ${line.trim()}`;
    else open = null;
  }
  return rules;
}

function serializeRules(rules: readonly DesignRule[]): string {
  return rules.map((r) => `- ${r.kind === "do" ? "Do" : "Don't"}: ${r.text}`).join("\n");
}

function rulesFrom(markdown: string): DesignRules {
  const sections = markdownSections(markdown);
  return {
    intent: designMdSection(sections, INTENT_SECTION)?.trim() ?? "",
    rules: parseRules(designMdSection(sections, RULES_SECTION) ?? ""),
  };
}

function guidancePath(folder: DesignFolder): string {
  return join(folder.root, GUIDANCE_FILENAME);
}

/** The rules the folder is held to right now, read fresh from the document it follows. */
export async function readDesignRules(folder: DesignFolder): Promise<DesignRulesState> {
  const doc = designSystemDoc(folder);
  if (!doc) return { source: null, intent: "", rules: [] };
  const text = (await readDesignSystemDoc(folder)) ?? "";
  return {
    source: { path: doc.path, writable: doc.absolutePath === guidancePath(folder) },
    ...rulesFrom(text),
  };
}

/** The heading a section is already written under, so an alias is edited in place. */
function headingOf(sections: Record<string, string>, section: DesignMdSection): string | undefined {
  return Object.keys(sections).find(
    (heading) => heading !== "" && designMdSection({ [heading]: "x" }, section) !== undefined,
  );
}

function oneLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, " ").trim();
}

/**
 * Rewrite only the two sections this owns; whatever else the file says —
 * frontmatter, a hand-written Colors section — comes back as it was.
 */
export function mergeRules(existing: string | null, name: string, next: DesignRules): string {
  const sections = existing === null ? {} : markdownSections(existing);
  const preamble = sections[""] ?? `# ${name} design guidance`;
  const bodies = new Map(Object.entries(sections).filter(([heading]) => heading !== ""));
  const put = (section: DesignMdSection, body: string) => {
    const heading = headingOf(sections, section) ?? section;
    if (body === "") bodies.delete(heading);
    else bodies.set(heading, body);
  };
  put(INTENT_SECTION, next.intent.trim());
  put(
    RULES_SECTION,
    serializeRules(
      next.rules.map((r) => ({ kind: r.kind, text: oneLine(r.text) })).filter((r) => r.text !== ""),
    ),
  );
  // Overview leads and the rules close, as the spec orders them; sections this
  // does not own keep the order they were written in between.
  const intentHeading = headingOf(Object.fromEntries(bodies), INTENT_SECTION);
  const rulesHeading = headingOf(Object.fromEntries(bodies), RULES_SECTION);
  const ordered = [
    ...(intentHeading ? [intentHeading] : []),
    ...[...bodies.keys()].filter((h) => h !== intentHeading && h !== rulesHeading),
    ...(rulesHeading ? [rulesHeading] : []),
  ];
  const parts = [preamble, ...ordered.map((heading) => `## ${heading}\n\n${bodies.get(heading)}`)];
  return `${parts.join("\n\n")}\n`;
}

function designRulesReadOnly(path: string): MutationError {
  return badRequest(
    `This design follows ${path}, which belongs to the repo — Velloo reads it and never writes it. Edit the rules in that file; they are picked up as soon as it is saved.`,
  );
}

/**
 * Save the design's rules to its own `guidance.md`, creating the file when the
 * folder follows no document yet. Refused when the folder follows the repo's
 * `DESIGN.md`.
 */
export function writeDesignRules(
  ctx: MutationContext,
  next: DesignRules,
): Promise<Result<DesignRulesState, MutationError>> {
  return withConfigLock(ctx.folder, async () => {
    const doc = designSystemDoc(ctx.folder);
    const path = guidancePath(ctx.folder);
    if (doc && doc.absolutePath !== path) return err(designRulesReadOnly(doc.path));
    const existing = await readFile(path, "utf8").catch(() => null);
    await writeText(path, mergeRules(existing, ctx.folder.config.name, next));
    // The rules ride the theme's refresh: they are the same design language,
    // and a dedicated event would be one more type every client has to learn.
    ctx.broadcast({ type: "theme-changed" });
    return ok(await readDesignRules(ctx.folder));
  });
}

/**
 * Put the rules back to what they were when someone started editing them and
 * then thought better of it. `null` means the design followed no document at
 * that point: the two sections this owns are taken out again, and the file
 * goes with them only if nothing else was ever written in it.
 */
export function restoreDesignRules(
  ctx: MutationContext,
  baseline: DesignRules | null,
): Promise<Result<DesignRulesState, MutationError>> {
  if (baseline !== null) return writeDesignRules(ctx, baseline);
  return withConfigLock(ctx.folder, async () => {
    const doc = designSystemDoc(ctx.folder);
    const path = guidancePath(ctx.folder);
    if (doc && doc.absolutePath !== path) return err(designRulesReadOnly(doc.path));
    const existing = await readFile(path, "utf8").catch(() => null);
    if (existing !== null) {
      const name = ctx.folder.config.name;
      const emptied = mergeRules(existing, name, { intent: "", rules: [] });
      if (emptied === mergeRules(null, name, { intent: "", rules: [] })) await rm(path);
      else await writeText(path, emptied);
      ctx.broadcast({ type: "theme-changed" });
    }
    return ok(await readDesignRules(ctx.folder));
  });
}
