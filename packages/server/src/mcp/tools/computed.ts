import { readFileSync } from "node:fs";
import { join } from "node:path";
import { captureDir, type DomExtract, type DomNode } from "@velloo/renderer";

/**
 * Reading a Velloo render the way a browser resolved it.
 *
 * `inspect` could always say which component rendered; it could not say what
 * that component rendered *as*. Finding a collapsed button meant eyeballing a
 * PNG and then reasoning about which Tailwind utility won the cascade — the
 * kind of prediction that is fragile to make and impossible to check. These
 * helpers turn the guess into a measurement, and let the same measurement be
 * compared against a captured page property by property.
 */

/** One measured element, addressed by the design node that produced it. */
export interface MeasuredNode {
  /** Dotted design path ("" = root). */
  path: string;
  tag: string;
  class?: string;
  rect: { x: number; y: number; w: number; h: number };
  style: Record<string, string>;
}

function measure(node: DomNode): MeasuredNode {
  return {
    path: node.nodePath ?? "",
    tag: node.tag,
    ...(node.class ? { class: node.class } : {}),
    rect: node.rect,
    style: node.style,
  };
}

/**
 * The element a design path rendered as. Depth-first pre-order means the first
 * match is the outermost one, which is the element the node's own styling is
 * on — a component that spreads its props onto several elements still reads as
 * the box it occupies.
 */
export function measuredAt(dom: DomExtract, path: number[]): MeasuredNode | null {
  const key = path.join(".");
  const found = dom.nodes.find((n) => n.nodePath === key);
  return found ? measure(found) : null;
}

/**
 * Direct child design nodes of `path`, measured. A parent's own box rarely
 * explains a layout on its own — "the button is 0px tall" is usually a fact
 * about what is inside it.
 */
export function childrenMeasuredAt(dom: DomExtract, path: number[], limit = 12): MeasuredNode[] {
  const prefix = path.length === 0 ? "" : `${path.join(".")}.`;
  const out: MeasuredNode[] = [];
  for (const node of dom.nodes) {
    const p = node.nodePath;
    if (p === undefined || !p.startsWith(prefix) || p === prefix.slice(0, -1)) continue;
    // Direct children only: one more segment than the parent.
    if (p.slice(prefix.length).includes(".")) continue;
    out.push(measure(node));
    if (out.length >= limit) break;
  }
  return out;
}

/** Fraction of `a` covered by `b`, both in the same coordinate space. */
function overlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const area = a.w * a.h;
  return area > 0 ? (ix * iy) / area : 0;
}

/**
 * The captured page's element sitting where a design node sits. Pairing by
 * geometry rather than by tree position is deliberate: the two trees are not
 * the same shape (that is what the port is *for*), but a faithful port puts
 * the same thing in the same place, so position is the honest correspondence.
 */
export function counterpartOf(
  reference: DomExtract,
  rect: { x: number; y: number; w: number; h: number },
): MeasuredNode | null {
  let best: DomNode | null = null;
  let bestScore = 0;
  for (const node of reference.nodes) {
    // Both directions: an element that merely contains the rect (a page
    // wrapper) is not its counterpart, and neither is a tiny child inside it.
    const score = Math.min(overlap(rect, node.rect), overlap(node.rect, rect));
    if (score > bestScore) {
      bestScore = score;
      best = node;
    }
  }
  return best && bestScore >= 0.6 ? measure(best) : null;
}

export interface StyleDifference {
  property: string;
  design: string;
  page: string;
}

/**
 * Properties that differ between a design node and its counterpart. Only the
 * differences: the properties that already agree are the ones nobody needs to
 * read. Absent on one side is reported as `""` — a missing `height` is exactly
 * the finding, not a reason to skip the row.
 */
export function styleDifferences(
  design: MeasuredNode,
  page: MeasuredNode,
  limit = 8,
): StyleDifference[] {
  const out: StyleDifference[] = [];
  for (const property of new Set([...Object.keys(design.style), ...Object.keys(page.style)])) {
    const a = design.style[property] ?? "";
    const b = page.style[property] ?? "";
    if (a !== b) out.push({ property, design: a, page: b });
    if (out.length >= limit) break;
  }
  return out;
}

/** The stored DOM extract of a capture, or null when it has none (theme-only). */
export function readCaptureDom(
  folderRoot: string,
  captureId: string,
  folderId: string | undefined,
): DomExtract | null {
  try {
    return JSON.parse(
      readFileSync(join(captureDir(folderRoot, captureId, folderId), "dom.json"), "utf8"),
    ) as DomExtract;
  } catch {
    return null;
  }
}

/** A mismatching region resolved to the design node that owns it. */
interface ResolvedRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  changedPixels?: number | undefined;
  node: { path: number[]; ref?: string | undefined; id?: string | undefined } | null;
}

export interface RegionStyleDiff {
  /** The design node responsible, in the same form `topMismatches` names it. */
  node: string;
  path: number[];
  /** Box sizes, `w×h` in CSS px, when they disagree. */
  size?: { design: string; page: string };
  differs: StyleDifference[];
}

/**
 * Per-region style differences, worst region first.
 *
 * Regions are in image pixels and both extracts are in their own CSS pixels;
 * the diff only aligns because both sides were captured at the same viewport,
 * so dividing by the scale factor puts everything in one space.
 */
export function styleDiffForRegions(
  regions: ResolvedRegion[],
  design: DomExtract,
  reference: DomExtract,
  scaleFactor: number,
  limit = 5,
): RegionStyleDiff[] {
  const out: RegionStyleDiff[] = [];
  const seen = new Set<string>();
  for (const region of regions) {
    if (out.length >= limit) break;
    if (!region.node) continue;
    const key = region.node.path.join(",");
    if (seen.has(key)) continue;
    const designNode = measuredAt(design, region.node.path);
    if (!designNode) continue;
    const counterpart = counterpartOf(reference, {
      x: region.x / scaleFactor,
      y: region.y / scaleFactor,
      w: region.w / scaleFactor,
      h: region.h / scaleFactor,
    });
    if (!counterpart) continue;
    seen.add(key);
    const differs = styleDifferences(designNode, counterpart);
    const sizeDiffers =
      designNode.rect.w !== counterpart.rect.w || designNode.rect.h !== counterpart.rect.h;
    if (differs.length === 0 && !sizeDiffers) continue;
    out.push({
      node: `${region.node.ref ?? "node"}${region.node.id ? `#${region.node.id}` : ""} @[${key}]`,
      path: region.node.path,
      ...(sizeDiffers
        ? {
            size: {
              design: `${designNode.rect.w}×${designNode.rect.h}`,
              page: `${counterpart.rect.w}×${counterpart.rect.h}`,
            },
          }
        : {}),
      differs,
    });
  }
  return out;
}
