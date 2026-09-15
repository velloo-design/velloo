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
  /** Changed pixels inside this rect — ranks regions by change magnitude, not just area.
   *  Set by diffPngs; optional so ad-hoc rects (crop targets) don't need it. */
  changedPixels?: number;
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
  // Count changed pixels per region and rank by magnitude — a dense small region
  // usually matters more than a sparse large one. (Bounding boxes may overlap, so
  // counts can double-count a few pixels; fine for ranking.)
  for (const r of regions) {
    let n = 0;
    for (let y = r.y; y < r.y + r.h; y++) {
      const row = y * width;
      for (let x = r.x; x < r.x + r.w; x++) n += mask[row + x] as number;
    }
    r.changedPixels = n;
  }
  regions.sort((a, b) => (b.changedPixels ?? 0) - (a.changedPixels ?? 0));

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
/**
 * Box-downsample a PNG by an integer factor.
 *
 * Exists to reconcile a stored capture with a fresh render: a capture taken in
 * a real browser window lands at the display's device pixel ratio (2 on a
 * Retina Mac), while a Velloo render is rasterized at whatever scale the caller
 * asked for. Both sides have to be in the same pixel space before a diff means
 * anything. The factor is always integral here — device pixel ratios are whole
 * numbers and the compare path snaps its scale to 1, 1/2, or 1/4 — so a plain
 * box average is exact and needs no resampling kernel.
 */
export function downscalePng(png: Buffer, factor: number): Buffer {
  if (!Number.isInteger(factor) || factor <= 1) return png;
  const src = PNG.sync.read(png);
  const width = Math.max(1, Math.floor(src.width / factor));
  const height = Math.max(1, Math.floor(src.height / factor));
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let dy = 0; dy < factor; dy++) {
        const sy = y * factor + dy;
        if (sy >= src.height) break;
        for (let dx = 0; dx < factor; dx++) {
          const sx = x * factor + dx;
          if (sx >= src.width) break;
          const i = (sy * src.width + sx) << 2;
          r += src.data[i] ?? 0;
          g += src.data[i + 1] ?? 0;
          b += src.data[i + 2] ?? 0;
          a += src.data[i + 3] ?? 0;
          n++;
        }
      }
      const o = (y * width + x) << 2;
      out.data[o] = Math.round(r / n);
      out.data[o + 1] = Math.round(g / n);
      out.data[o + 2] = Math.round(b / n);
      out.data[o + 3] = Math.round(a / n);
    }
  }
  return PNG.sync.write(out);
}

/** Resize to exact bitmap dimensions for non-integer display scale factors. */
export function resizePng(png: Buffer, width: number, height: number): Buffer {
  const src = PNG.sync.read(png);
  const outWidth = Math.max(1, Math.round(width));
  const outHeight = Math.max(1, Math.round(height));
  if (src.width === outWidth && src.height === outHeight) return png;
  const out = new PNG({ width: outWidth, height: outHeight });
  for (let y = 0; y < outHeight; y++) {
    const sy = Math.max(0, Math.min(src.height - 1, ((y + 0.5) * src.height) / outHeight - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(src.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < outWidth; x++) {
      const sx = Math.max(0, Math.min(src.width - 1, ((x + 0.5) * src.width) / outWidth - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(src.width - 1, x0 + 1);
      const fx = sx - x0;
      const dst = (y * outWidth + x) << 2;
      for (let channel = 0; channel < 4; channel++) {
        const a = src.data[(y0 * src.width + x0) * 4 + channel] ?? 0;
        const b = src.data[(y0 * src.width + x1) * 4 + channel] ?? 0;
        const c = src.data[(y1 * src.width + x0) * 4 + channel] ?? 0;
        const d = src.data[(y1 * src.width + x1) * 4 + channel] ?? 0;
        const top = a + (b - a) * fx;
        const bottom = c + (d - c) * fx;
        out.data[dst + channel] = Math.round(top + (bottom - top) * fy);
      }
    }
  }
  return PNG.sync.write(out);
}

/** Pixel dimensions of an encoded PNG. */
export function pngSize(png: Buffer): { width: number; height: number } {
  const p = PNG.sync.read(png);
  return { width: p.width, height: p.height };
}

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
