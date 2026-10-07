import type { DomExtract, DomNode } from "@velloo/renderer";

/**
 * What the two renders *say*, compared.
 *
 * A pixel diff weighs a difference by its area, so the differences a reader
 * cares most about are the ones it cannot see: a changed opening hour, a price,
 * a phone number — a handful of glyphs in a page of thousands, well inside the
 * score's noise. Both sides were already walked for their text, so the words
 * are compared directly, and what comes back is the copy that differs rather
 * than a region that might hold it.
 */
export interface TextDiff {
  /** The same line on both sides, worded differently. */
  changed?: { page: string; design: string; node?: string }[];
  /** Text the page shows that the design does not. */
  missing?: string[];
  /** Text the design shows that the page does not. */
  extra?: { text: string; node?: string }[];
  /** Differences beyond the ones listed. */
  omitted?: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One element's own text, as the reader sees it. */
interface Run {
  text: string;
  /** `text` with the differences nobody ports for folded away — what two runs are matched on. */
  key: string;
  words: string[];
  rect: Rect;
  /** Dotted path of the design node that drew it; absent on a captured page. */
  path?: string;
}

const WORD = /[\p{L}\p{N}]+/gu;
const LIST_LIMIT = 8;
const TEXT_LIMIT = 160;
/** Past this many unmatched runs a side the page is a different page, and pairing them is quadratic noise. */
const PAIRING_LIMIT = 300;
const SIMILAR = 0.5;
/**
 * Past this share of a side's lines differing — and more of them than a list
 * holds — the two renders are not one page worded two ways: a section is
 * missing, or the design did not mount. The score and the height already say
 * that; a few hundred lines would say it again in the least usable form.
 */
const SAME_PAGE = 0.5;

/**
 * `text-transform` is part of what the reader sees and not part of the DOM
 * text: a page that upper-cases a label in CSS and a design that types it in
 * capitals say the same thing.
 */
function shownText(text: string, transform: string | undefined): string {
  if (transform === "uppercase") return text.toUpperCase();
  if (transform === "lowercase") return text.toLowerCase();
  if (transform === "capitalize") return text.replace(/(^|\s)(\p{L})/gu, (m) => m.toUpperCase());
  return text;
}

/**
 * Typographic variants of one character are not a copy difference worth a
 * round trip: a design typed with a straight apostrophe matches a page set
 * with a curly one.
 */
function keyOf(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function designPathOf(dom: DomExtract, node: DomNode): string | undefined {
  let at: DomNode | undefined = node;
  while (at) {
    if (at.nodePath !== undefined) return at.nodePath;
    at = at.parent === null ? undefined : dom.nodes[at.parent];
  }
  return undefined;
}

/**
 * The lines a render shows, in document order. An element that reads as one
 * line with its inline descendants (`line`) is that line, and the descendants
 * are passed over — they are already in it. `clipHeight` keeps a viewport
 * comparison to the text that viewport holds.
 */
function runsOf(dom: DomExtract, clipHeight: number | undefined): Run[] {
  const runs: Run[] = [];
  let withinLineAt: number | null = null;
  for (const node of dom.nodes) {
    if (withinLineAt !== null) {
      if (node.depth > withinLineAt) continue;
      withinLineAt = null;
    }
    if (!node.text) continue;
    if (node.line !== undefined) withinLineAt = node.depth;
    if (clipHeight !== undefined) {
      if (node.rect.y >= clipHeight || node.rect.y + node.rect.h <= 0) continue;
    }
    const text = node.line ?? shownText(node.text, node.style.textTransform);
    const key = keyOf(text);
    // Text with no letter or digit in it is a bullet, a divider or an icon
    // font's glyph: decoration, not copy.
    const words = key.match(WORD);
    if (!words) continue;
    const path = designPathOf(dom, node);
    runs.push({ text, key, words, rect: node.rect, ...(path !== undefined ? { path } : {}) });
  }
  return runs;
}

/** Runs of each side left once every identical line has been paired off, in document order. */
function unmatched(page: Run[], design: Run[]): { page: Run[]; design: Run[] } {
  const byKey = new Map<string, Run[]>();
  for (const run of design) {
    const bucket = byKey.get(run.key);
    if (bucket) bucket.push(run);
    else byKey.set(run.key, [run]);
  }
  const pageLeft: Run[] = [];
  for (const run of page) {
    const bucket = byKey.get(run.key);
    if (bucket?.length) bucket.shift();
    else pageLeft.push(run);
  }
  const left = new Set([...byKey.values()].flat());
  return { page: pageLeft, design: design.filter((run) => left.has(run)) };
}

function wordCounts(runs: Run[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const run of runs)
    for (const word of run.words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
}

/**
 * The runs holding a word their side has more of than the other.
 *
 * Two trees that say the same thing rarely split it the same way: the page's
 * `<p>Open <strong>9am</strong> to 5pm</p>` is two runs and a design's single
 * `Text` is one, and none of the three lines equals another. Counted as words
 * they agree, so only a run with a word the other side cannot account for is a
 * difference in what is said rather than in how the markup is cut.
 */
function differing(runs: Run[], other: Run[]): Set<Run> {
  const surplus = wordCounts(runs);
  for (const [word, count] of wordCounts(other)) {
    const mine = surplus.get(word);
    if (mine !== undefined) surplus.set(word, mine - count);
  }
  const out = new Set<Run>();
  for (const run of runs) {
    for (const word of run.words) {
      const left = surplus.get(word) ?? 0;
      if (left <= 0) continue;
      surplus.set(word, left - 1);
      out.add(run);
    }
  }
  return out;
}

function bigrams(key: string): Map<string, number> {
  const s = key.toLowerCase();
  const grams = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const gram = s.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Sørensen–Dice over character pairs: how much of two lines is the same wording, 0–1. */
function wordingSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let shared = 0;
  let sizeA = 0;
  let sizeB = 0;
  for (const count of a.values()) sizeA += count;
  for (const [gram, count] of b) {
    sizeB += count;
    shared += Math.min(count, a.get(gram) ?? 0);
  }
  return sizeA + sizeB === 0 ? 0 : (2 * shared) / (sizeA + sizeB);
}

function intersectionOverUnion(a: Rect, b: Rect): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const union = a.w * a.h + b.w * b.h - ix * iy;
  return union > 0 ? (ix * iy) / union : 0;
}

/**
 * Pair a differing line with the line it is a rewording of. Wording first — a
 * line that moved is still the same line — and failing that position: two
 * unrelated lines filling the same box are one slot whose copy was replaced.
 * A wording match always outranks a positional one.
 */
function pairUp(
  page: Run[],
  design: Run[],
  differs: (run: Run) => boolean,
): { page: Run; design: Run }[] {
  const withGrams = (runs: Run[]) => runs.map((run) => ({ run, grams: bigrams(run.key) }));
  const designSide = withGrams(design);
  const candidates: { p: number; d: number; score: number }[] = [];
  for (const [p, mine] of withGrams(page).entries()) {
    for (const [d, theirs] of designSide.entries()) {
      if (!differs(mine.run) && !differs(theirs.run)) continue;
      const wording = wordingSimilarity(mine.grams, theirs.grams);
      if (wording >= SIMILAR) {
        candidates.push({ p, d, score: 1 + wording });
        continue;
      }
      const placed = intersectionOverUnion(mine.run.rect, theirs.run.rect);
      if (placed >= SIMILAR) candidates.push({ p, d, score: placed });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.p - b.p || a.d - b.d);
  const usedPage = new Set<number>();
  const usedDesign = new Set<number>();
  const pairs: { page: Run; design: Run }[] = [];
  for (const { p, d } of candidates) {
    if (usedPage.has(p) || usedDesign.has(d)) continue;
    usedPage.add(p);
    usedDesign.add(d);
    pairs.push({ page: page[p] as Run, design: design[d] as Run });
  }
  return pairs;
}

const clip = (text: string) => (text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text);
const topDown = (a: Rect, b: Rect) => a.y - b.y || a.x - b.x;

/**
 * The copy that differs between a design's render and the page it ports, or
 * null when they say the same thing — or so little of the same thing that the
 * difference is not one of copy.
 *
 * `label` names a design node from its dotted path, in the form the rest of
 * the result uses. `clipHeight` (CSS px) limits a viewport comparison to what
 * that viewport shows.
 */
export function diffText(
  design: DomExtract,
  page: DomExtract,
  opts: { label?: (path: string) => string; clipHeight?: number } = {},
): TextDiff | null {
  const pageRuns = runsOf(page, opts.clipHeight);
  const designRuns = runsOf(design, opts.clipHeight);
  const left = unmatched(pageRuns, designRuns);
  const pageDiffers = differing(left.page, left.design);
  const designDiffers = differing(left.design, left.page);
  if (pageDiffers.size === 0 && designDiffers.size === 0) return null;
  const anotherPage = (differs: Set<Run>, all: Run[]) =>
    differs.size > LIST_LIMIT && differs.size > all.length * SAME_PAGE;
  if (anotherPage(pageDiffers, pageRuns) || anotherPage(designDiffers, designRuns)) return null;

  const pairs =
    left.page.length <= PAIRING_LIMIT && left.design.length <= PAIRING_LIMIT
      ? pairUp(left.page, left.design, (run) => pageDiffers.has(run) || designDiffers.has(run))
      : [];
  const paired = new Set(pairs.flatMap((pair) => [pair.page, pair.design]));
  const nodeOf = (run: Run) =>
    run.path !== undefined && opts.label ? { node: opts.label(run.path) } : {};

  const changed = pairs
    .sort((a, b) => topDown(a.page.rect, b.page.rect))
    .map((pair) => ({
      page: clip(pair.page.text),
      design: clip(pair.design.text),
      ...nodeOf(pair.design),
    }));
  const missing = [
    ...new Set(
      [...pageDiffers]
        .filter((run) => !paired.has(run))
        .sort((a, b) => topDown(a.rect, b.rect))
        .map((run) => clip(run.text)),
    ),
  ];
  const extra = [...designDiffers]
    .filter((run) => !paired.has(run))
    .sort((a, b) => topDown(a.rect, b.rect))
    .map((run) => ({ text: clip(run.text), ...nodeOf(run) }));

  const omitted =
    Math.max(0, changed.length - LIST_LIMIT) +
    Math.max(0, missing.length - LIST_LIMIT) +
    Math.max(0, extra.length - LIST_LIMIT);
  return {
    ...(changed.length ? { changed: changed.slice(0, LIST_LIMIT) } : {}),
    ...(missing.length ? { missing: missing.slice(0, LIST_LIMIT) } : {}),
    ...(extra.length ? { extra: extra.slice(0, LIST_LIMIT) } : {}),
    ...(omitted > 0 ? { omitted } : {}),
  };
}
