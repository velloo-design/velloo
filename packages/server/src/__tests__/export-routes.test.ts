import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromiumExecutable, closePooledBrowser } from "@velloo/renderer";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { createApp } from "../app.ts";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import type { MutationContext } from "../mutations/index.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";

const provider = createShadcnProvider();
const hasChromium = (await chromiumExecutable()) !== null;

/**
 * The /api/export routes: standalone HTML runs browser-less and is
 * asserted structurally (self-contained, data-URI assets, no scripts);
 * PNG/PDF capture is gated on an installed chromium like the other browser
 * suites. Lookup/validation errors are covered for every target kind.
 */

const sampleConfig = {
  schemaVersion: 2,
  toolVersion: "0.1.0",
  libraries: {
    default: {
      id: "shadcn-upstream" as const,
      version: "test",
      source: "binary",
      componentsPath: "binary",
    },
  },
  defaultLibrary: "default",
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

const sampleTheme = {
  name: "default",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.55 0.18 280)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

// A tiny valid PNG (1×1, transparent) for asset inlining.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const homeScreen = {
  id: "home",
  name: "Home",
  tree: {
    $ref: "Box",
    props: { className: "p-8 flex flex-col gap-4" },
    children: [
      { $ref: "Heading", props: { level: 1, children: "Welcome home" } },
      { $ref: "Image", props: { src: "/assets/logo.png", alt: "logo" } },
    ],
  },
};

const aboutScreen = {
  id: "about",
  name: "About",
  tree: {
    $ref: "Box",
    props: { className: "p-8" },
    children: [{ $ref: "Text", props: { children: "About us" } }],
  },
};

// The two frames deliberately have DIFFERENT viewports so the board-PDF test
// can prove each deck page keeps its own frame's size (Chromium named pages).
const mainBoard = {
  id: "main",
  name: "Main flow",
  frames: [
    { id: "f-home", screen: "home", x: 0, y: 0, w: 480, h: 360, label: "Home / desktop" },
    { id: "f-about", screen: "about", x: 560, y: 0, w: 800, h: 600 },
  ],
  groups: [],
};

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

let tmp: string;
let folder: DesignFolder;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-export-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  for (const dir of [".design", "theme", "screens", "boards", "assets"]) {
    await mkdir(join(tmp, dir), { recursive: true });
  }
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "screens/home.json"), homeScreen);
  await writeJson(join(tmp, "screens/about.json"), aboutScreen);
  await writeJson(join(tmp, "boards/main.json"), mainBoard);
  await writeFile(join(tmp, "assets/logo.png"), PNG_BYTES);
  folder = await loadDesignFolder(tmp);
  const jit = new TailwindJit(provider, join(folder.root, "screens"));
  const bundler = new LiveBundler(
    folder.root,
    () => folder.config,
    () => liveExtensions(folder.config.extensions),
  );
  const canvasBundler = new CanvasBundler(
    folder.root,
    () => folder.config.hostApp,
    () => undefined,
  );
  const ctx: MutationContext = {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: () => undefined,
  };
  app = createApp(() => ctx, jit, bundler, canvasBundler);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const get = (path: string) => app.fetch(new Request(`http://localhost${path}`));

describe("standalone HTML export (browser-less)", () => {
  test("screen → self-contained document: data-URI assets, no scripts, no base href", async () => {
    const res = await get("/api/export/screen/home.html");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-disposition")).toContain('filename="Home.html"');
    const html = await res.text();
    expect(html).toContain("Welcome home");
    // The referenced asset is embedded, not linked.
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain('src="/assets/');
    // Self-contained: no server base, no runtime/live/canvas scripts at all.
    expect(html).not.toContain("<base");
    expect(html).not.toContain("<script");
  });

  test("dark mode lands on the html element", async () => {
    const res = await get("/api/export/screen/home.html?mode=dark");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('class="dark"');
  });

  test("frame → its screen at the frame viewport", async () => {
    const res = await get("/api/export/frame/f-home.html");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain('filename="Home-desktop.html"');
    const html = await res.text();
    expect(html).toContain("Welcome home");
    expect(html).toContain("width=480");
  });

  test("board → one composite document with labeled srcdoc iframes", async () => {
    const res = await get("/api/export/board/main.html");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect((html.match(/<iframe/g) ?? []).length).toBe(2);
    // Label chips: the explicit frame label, and the screen-name fallback.
    expect(html).toContain("Home / desktop");
    expect(html).toContain("About");
    // The embedded frame docs are themselves inlined (asset data-URI escaped in srcdoc).
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain("src=&quot;/assets/");
  });

  test("a missing asset degrades to a warning header, not a failure", async () => {
    await rm(join(tmp, "assets/logo.png"));
    const res = await get("/api/export/screen/home.html");
    expect(res.status).toBe(200);
    const warnings = JSON.parse(
      decodeURIComponent(res.headers.get("x-velloo-export-warnings") ?? "[]"),
    ) as string[];
    expect(warnings.some((w) => w.includes("asset not found"))).toBe(true);
  });
});

describe("export route validation", () => {
  test("unknown ids answer 404 per target kind", async () => {
    expect((await get("/api/export/frame/nope.png")).status).toBe(404);
    expect((await get("/api/export/board/nope.png")).status).toBe(404);
    expect((await get("/api/export/screen/nope.html")).status).toBe(404);
  });

  test("bad extension and bad mode answer 400", async () => {
    expect((await get("/api/export/frame/f-home.gif")).status).toBe(400);
    expect((await get("/api/export/frame/f-home.png?mode=sepia")).status).toBe(400);
  });

  test("compare is frame-PNG-only", async () => {
    expect((await get("/api/export/frame/f-home.pdf?mode=compare")).status).toBe(400);
    expect((await get("/api/export/board/main.png?mode=compare")).status).toBe(400);
  });

  test("screen exports are HTML-only on the routes", async () => {
    expect((await get("/api/export/screen/home.png")).status).toBe(400);
  });
});

describe.if(hasChromium)("PNG/PDF export (chromium)", () => {
  afterEach(async () => {
    await closePooledBrowser();
  });

  test("frame → PNG bytes at the frame viewport", async () => {
    const res = await get("/api/export/frame/f-home.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 30_000);

  test("frame → single-page PDF; board → one page per frame in board order, each at its own frame size", async () => {
    const frameRes = await get("/api/export/frame/f-home.pdf");
    expect(frameRes.status).toBe(200);
    expect(frameRes.headers.get("content-type")).toBe("application/pdf");
    const framePdf = Buffer.from(await frameRes.arrayBuffer());
    expect(framePdf.subarray(0, 5).toString()).toBe("%PDF-");

    const boardRes = await get("/api/export/board/main.pdf");
    expect(boardRes.status).toBe(200);
    const boardPdf = Buffer.from(await boardRes.arrayBuffer());
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(framePdf)).getPageCount()).toBe(1);
    const deck = await PDFDocument.load(boardPdf);
    expect(deck.getPageCount()).toBe(2);
    // The deck is a SINGLE Chromium print job with per-named-page CSS sizes;
    // the two frames have different viewports (480×360 vs 800×600), so their
    // pages must come out at different sizes — 0.75pt per CSS px, ±5pt slack
    // for print rounding. Uniform pages would mean Chromium ignored the
    // named-page sizes.
    const first = deck.getPage(0).getSize();
    const second = deck.getPage(1).getSize();
    expect(first.width).toBeCloseTo(480 * 0.75, -1);
    expect(first.height).toBeCloseTo(360 * 0.75, -1);
    expect(second.width).toBeCloseTo(800 * 0.75, -1);
    expect(second.height).toBeCloseTo(600 * 0.75, -1);
  }, 60_000);

  test("board → composite PNG", async () => {
    const res = await get("/api/export/board/main.png?mode=dark");
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 30_000);
});
