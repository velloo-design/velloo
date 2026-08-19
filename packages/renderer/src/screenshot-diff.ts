import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

/**
 * Pixel diff between two PNG captures of the same screen. Pure — no
 * Playwright — so the algorithm is testable with synthetic images.
 *
 * Full-page captures legitimately change height as content grows; both
 * images are padded to the union dimensions and padded area counts as
 * changed (added/removed content *is* change). `heightDelta` reports
 * the growth separately so "the screen got 200px taller" is legible
 * without looking at pixels.
 */
export interface DiffRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiffResult {
  changedPixels: number;
  /** changedPixels / union area, 0..1. */
  changedRatio: number;
  /**
   * changedRatio over only the *overlapping* height (`min(a,b)`), excluding
   * the added/removed bottom strip the height delta creates. On a tall
   * single-column page a tiny cumulative vertical drift inflates `changedRatio`
   * far past what the structural match deserves; this normalizes that out.
   * Equals `changedRatio` when heights match.
   */
  contentChangedRatio: number;
  /** after.height - before.height (pre-padding), in pixels. */
  heightDelta: number;
  width: number;
  height: number;
  /** Changed areas clustered into rectangles (max ~10, merged beyond). */
  regions: DiffRegion[];
  /** Magenta-highlight overlay (after image dimmed, diffs marked). */
  diffPng: Buffer;
}

export interface DiffOptions {
  /** pixelmatch perceptual threshold. Default 0.1. */
  threshold?: number;
  /** Dirty-cell size for region clustering, px. Default 16. */
  cellSize?: number;
  /** Cap on returned regions; excess merges into the largest. Default 10. */
  maxRegions?: number;
}

function padToUnion(png: PNG, width: number, height: number): PNG {
  if (png.width === width && png.height === height) return png;
  const out = new PNG({ width, height, fill: true });
  PNG.bitblt(png, out, 0, 0, png.width, png.height, 0, 0);
  return out;
}

/**
 * Cluster the per-pixel diff mask into rectangles via a dirty-cell
 * grid: mark every cell containing a changed pixel, then greedily grow
 * rectangles over connected dirty cells.
 */
function clusterRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  cellSize: number,
  maxRegions: number,
): DiffRegion[] {
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const dirty = new Uint8Array(cols * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) {
        dirty[Math.floor(y / cellSize) * cols + Math.floor(x / cellSize)] = 1;
      }
    }
  }

  const seen = new Uint8Array(cols * rows);
  const regions: DiffRegion[] = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const idx = cy * cols + cx;
      if (!dirty[idx] || seen[idx]) continue;
      // BFS over connected dirty cells (4-neighborhood).
      let minX = cx;
      let maxX = cx;
      let minY = cy;
      let maxY = cy;
      const queue = [idx];
      seen[idx] = 1;
      while (queue.length > 0) {
        const cur = queue.pop() as number;
        const x = cur % cols;
        const y = Math.floor(cur / cols);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const nIdx = ny * cols + nx;
          if (dirty[nIdx] && !seen[nIdx]) {
            seen[nIdx] = 1;
            queue.push(nIdx);
          }
        }
      }
      regions.push({
        x: minX * cellSize,
        y: minY * cellSize,
        w: Math.min((maxX + 1) * cellSize, width) - minX * cellSize,
        h: Math.min((maxY + 1) * cellSize, height) - minY * cellSize,
      });
    }
  }

  regions.sort((a, b) => b.w * b.h - a.w * a.h);
  if (regions.length > maxRegions) {
    // Merge the long tail into one bounding box appended at the end.
    const tail = regions.slice(maxRegions - 1);
    const minX = Math.min(...tail.map((r) => r.x));
    const minY = Math.min(...tail.map((r) => r.y));
    const maxX = Math.max(...tail.map((r) => r.x + r.w));
    const maxY = Math.max(...tail.map((r) => r.y + r.h));
    return [
      ...regions.slice(0, maxRegions - 1),
      { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    ];
  }
  return regions;
}

export function diffPngs(before: Buffer, after: Buffer, options: DiffOptions = {}): DiffResult {
  const a = PNG.sync.read(before);
  const b = PNG.sync.read(after);
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const pa = padToUnion(a, width, height);
  const pb = padToUnion(b, width, height);

  const diff = new PNG({ width, height });
  const changedPixels = pixelmatch(pa.data, pb.data, diff.data, width, height, {
    threshold: options.threshold ?? 0.1,
    includeAA: false,
    alpha: 0.6,
  });

  // Rebuild a boolean mask from the diff image: pixelmatch paints
  // changed pixels opaque red/yellow; unchanged are grayscale+alpha.
  // Cheaper than a second comparison pass: a pixel is "changed" when
  // it is fully red-dominant.
  const mask = new Uint8Array(width * height);
  if (changedPixels > 0) {
    const d = diff.data;
    for (let i = 0; i < width * height; i++) {
      const r = d[i * 4] as number;
      const g = d[i * 4 + 1] as number;
      const bch = d[i * 4 + 2] as number;
      if (r > 200 && g < 120 && bch < 120) mask[i] = 1;
    }
  }

  const regions =
    changedPixels === 0
      ? []
      : clusterRegions(mask, width, height, options.cellSize ?? 16, options.maxRegions ?? 10);

  // Height-normalized diff: re-run over just the overlapping rows. The padded
  // buffers are top-aligned and row-major, so the first `contentHeight` rows
  // are exactly the overlap — pixelmatch reads only that prefix when handed
  // the shorter height. Skip the second pass when heights already match.
  const contentHeight = Math.min(a.height, b.height);
  const contentLen = width * contentHeight * 4;
  const contentChangedPixels =
    contentHeight === height
      ? changedPixels
      : pixelmatch(
          pa.data.subarray(0, contentLen),
          pb.data.subarray(0, contentLen),
          undefined,
          width,
          contentHeight,
          { threshold: options.threshold ?? 0.1, includeAA: false, alpha: 0.6 },
        );

  return {
    changedPixels,
    changedRatio: changedPixels / (width * height),
    contentChangedRatio: contentChangedPixels / (width * contentHeight),
    heightDelta: b.height - a.height,
    width,
    height,
    regions,
    diffPng: PNG.sync.write(diff),
  };
}

/** Crop a PNG buffer to a region (clamped to image bounds). */
export function cropPng(png: Buffer, region: DiffRegion, pad = 24): Buffer {
  const src = PNG.sync.read(png);
  const x = Math.max(0, region.x - pad);
  const y = Math.max(0, region.y - pad);
  const w = Math.min(src.width - x, region.w + pad * 2);
  const h = Math.min(src.height - y, region.h + pad * 2);
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(src, out, x, y, w, h, 0, 0);
  return PNG.sync.write(out);
}

/**
 * Compose two PNGs side by side on a white background with a gutter —
 * pure pngjs, no browser pass, so the comparison artifact is deterministic
 * and cheap. Left/right semantics are the caller's contract.
 */
export function sideBySidePng(left: Buffer, right: Buffer, gutter = 12): Buffer {
  const a = PNG.sync.read(left);
  const b = PNG.sync.read(right);
  const width = a.width + gutter + b.width;
  const height = Math.max(a.height, b.height);
  const out = new PNG({ width, height });
  out.data.fill(255);
  PNG.bitblt(a, out, 0, 0, a.width, a.height, 0, 0);
  PNG.bitblt(b, out, 0, 0, b.width, b.height, a.width + gutter, 0);
  return PNG.sync.write(out);
}

/** Union bounding box of a region list. */
export function unionRegion(regions: DiffRegion[]): DiffRegion {
  const minX = Math.min(...regions.map((r) => r.x));
  const minY = Math.min(...regions.map((r) => r.y));
  const maxX = Math.max(...regions.map((r) => r.x + r.w));
  const maxY = Math.max(...regions.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
