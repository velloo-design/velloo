import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { svgLooksActive } from "@velloo/schema";
import { storeAsset } from "../fs.ts";

let root: string;

beforeEach(() => {
  root = join(tmpdir(), `velloo-storeasset-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("storeAsset — SVG sanitization (FIX 2)", () => {
  test("strips active content from an uploaded .svg before it lands on disk", async () => {
    const hostile =
      '<svg xmlns="http://www.w3.org/2000/svg">' +
      '<image href="x" onerror="alert(1)"/>' +
      "<script>alert(2)</script>" +
      '<path d="M0 0h24"/>' +
      "</svg>";

    const stored = await storeAsset(root, "art.svg", Buffer.from(hostile, "utf8"));
    const onDisk = await readFile(join(root, "assets", "art.svg"), "utf8");

    expect(onDisk).not.toContain("onerror");
    expect(onDisk).not.toContain("<script");
    expect(onDisk).not.toContain("alert(");
    expect(svgLooksActive(onDisk)).toBe(false);
    // Static drawing survives; byte count reflects the sanitized output.
    expect(onDisk).toContain('<path d="M0 0h24"/>');
    expect(stored.bytes).toBe(Buffer.byteLength(onDisk, "utf8"));
    expect(stored.url).toBe("/assets/art.svg");
  });

  test("leaves non-SVG bytes untouched", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const stored = await storeAsset(root, "pic.png", png);
    const onDisk = await readFile(join(root, "assets", "pic.png"));
    expect(Buffer.compare(onDisk, png)).toBe(0);
    expect(stored.bytes).toBe(png.length);
  });
});
