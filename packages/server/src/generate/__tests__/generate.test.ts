import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@velloo/schema";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import { generateImage } from "../generate-image.ts";
import { generateSvg } from "../generate-svg.ts";

/**
 * Tests for the AI asset generators. The real LLM call is patched out
 * with `globalThis.fetch` so the tests don't need ANTHROPIC_API_KEY
 * and don't make network calls. The contract we care about:
 *
 *   - generate_svg cleans LLM artifacts (markdown fences, <svg> wrap)
 *   - generate_svg writes to assets/ when filename given
 *   - generate_svg fails gracefully with no API key
 *   - generate_image returns a stable Picsum URL seeded by prompt
 *   - generate_image dimensions match the requested aspect
 *   - generate_image fallback alt-text works without API key
 */

const sampleConfig = {
  schemaVersion: 1,
  toolVersion: "0.1.0",
  library: {
    id: "shadcn-react" as const,
    version: "test",
    source: "embedded:shadcn",
    componentsPath: "embedded:shadcn",
  },
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

const sampleTheme: Theme = {
  name: "test",
  colors: {
    background: "#fff",
    foreground: "#000",
    primary: { DEFAULT: "#000", foreground: "#fff" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

const sampleScreen = {
  id: "main",
  name: "Main",
  tree: { $ref: "Card" },
};

let tmp: string;
let folder: DesignFolder;
let prevFetch: typeof fetch;
let prevKey: string | undefined;
let prevFalKey: string | undefined;

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-gen-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "screens/main.json"), sampleScreen);
  folder = await loadDesignFolder(tmp);
  prevFetch = globalThis.fetch;
  prevKey = process.env.ANTHROPIC_API_KEY;
  prevFalKey = process.env.FAL_KEY;
});

afterEach(async () => {
  globalThis.fetch = prevFetch;
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = prevKey;
  if (prevFalKey === undefined) delete process.env.FAL_KEY;
  else process.env.FAL_KEY = prevFalKey;
  await rm(tmp, { recursive: true, force: true });
});

function stubAnthropic(text: string): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ content: [{ type: "text", text }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("generateSvg", () => {
  test("missing API key returns a friendly hint", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await generateSvg(folder, "a cloud");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("MissingApiKey");
  });

  test("empty prompt is rejected", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const r = await generateSvg(folder, "  ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("EmptyPrompt");
  });

  test("strips markdown fences from LLM output", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    stubAnthropic("```svg\n<circle cx='50' cy='50' r='40' />\n```");
    const r = await generateSvg(folder, "a circle");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.content).not.toContain("```");
      expect(r.value.content).toContain("<circle");
    }
  });

  test("strips outer <svg> wrapper if present", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    stubAnthropic(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" /></svg>',
    );
    const r = await generateSvg(folder, "a circle");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.content.toLowerCase()).not.toContain("<svg");
      expect(r.value.content).toContain("<circle");
    }
  });

  test("rejects model output with no element tags", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    stubAnthropic("just some text, no markup here");
    const r = await generateSvg(folder, "a circle");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ParseFailed");
  });

  test("rejects model output containing <script> or event handlers", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    stubAnthropic("<rect width='10' height='10' /><script>alert(1)</script>");
    const r = await generateSvg(folder, "a rect");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ParseFailed");
  });

  test("writes to assets/ when filename is given", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    stubAnthropic("<circle cx='10' cy='10' r='5' />");
    const r = await generateSvg(folder, "a circle", { filename: "ring" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.assetPath).toBe("assets/ring.svg");
      const onDisk = await readFile(join(tmp, "assets/ring.svg"), "utf8");
      expect(onDisk).toContain("<circle");
      expect(onDisk).toContain('viewBox="0 0 100 100"');
    }
  });

  test("sanitizes filename (no path traversal)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    stubAnthropic("<circle cx='10' cy='10' r='5' />");
    const r = await generateSvg(folder, "a circle", { filename: "../../../etc/passwd" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.assetPath).not.toContain("..");
      expect(r.value.assetPath).toMatch(/^assets\//);
    }
  });
});

describe("generateImage", () => {
  test("empty prompt is rejected", async () => {
    const r = await generateImage(folder, "");
    expect(r.ok).toBe(false);
  });

  test("returns a Picsum URL seeded by the prompt hash", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r1 = await generateImage(folder, "a sunset");
    const r2 = await generateImage(folder, "a sunset");
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      // Same prompt → same seed → same URL.
      expect(r1.value.src).toBe(r2.value.src);
      expect(r1.value.src).toMatch(/^https:\/\/picsum\.photos\/seed\//);
    }
  });

  test("different prompts produce different URLs", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r1 = await generateImage(folder, "a sunset");
    const r2 = await generateImage(folder, "a forest");
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r1.value.src).not.toBe(r2.value.src);
  });

  test("aspect 1:1 produces a square URL", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await generateImage(folder, "test", { aspect: "1:1" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.aspect).toBe("1/1");
      expect(r.value.src).toMatch(/\/800\/800$/);
    }
  });

  test("aspect 16:9 produces 1280x720 by default", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await generateImage(folder, "test", { aspect: "16:9" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.aspect).toBe("16/9");
      expect(r.value.src).toMatch(/\/1280\/720$/);
    }
  });

  test("width override scales height proportionally", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await generateImage(folder, "test", { aspect: "16:9", width: 1920 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.src).toMatch(/\/1920\/1080$/);
  });

  test("falls back to a prompt-derived alt text without API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await generateImage(folder, "happy team celebrating launch");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.alt.length).toBeGreaterThan(0);
    }
  });

  test("uses Claude alt text when API key is present", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    stubAnthropic("Team celebrating product launch");
    const r = await generateImage(folder, "happy team celebrating launch");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.alt).toBe("Team celebrating product launch");
  });

  test("source is claude+picsum when not using fal", async () => {
    const r = await generateImage(folder, "test");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.source).toBe("claude+picsum");
  });
});
