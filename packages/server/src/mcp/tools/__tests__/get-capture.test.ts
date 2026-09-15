import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type CaptureManifest, captureDir, writeCaptureManifest } from "@velloo/renderer";
import { testContext } from "../../../testing/design-folder.ts";
import { registerCaptureTools } from "../captures.ts";

/** A 4-byte-per-row PNG header is enough — only IHDR is ever read. */
function pngOf(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  buf.write("\x89PNG\r\n\x1a\n", 0, "latin1");
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "latin1");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

const CAPTURE_ID = "cap_20260909_bing";

let home: string;
let cleanup: () => Promise<void>;
let client: Client;
let dir: string;
const prevHome = process.env.VELLOO_HOME;

async function callGetCapture(
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await client.callTool({
    name: "get_capture",
    arguments: { captureId: CAPTURE_ID, ...args },
  });
  const content = res.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]?.text ?? "{}") as Record<string, unknown>;
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "velloo-home-"));
  process.env.VELLOO_HOME = home;
  const t = await testContext();
  cleanup = t.cleanup;

  dir = captureDir(t.folder.root, CAPTURE_ID, t.folder.config.folderId);
  await mkdir(dir, { recursive: true });
  writeFileSync(join(dir, "page.png"), pngOf(2440, 8712));
  writeFileSync(join(dir, "snapshot.mhtml"), "From: <Saved by Velloo>\n");
  writeFileSync(
    join(dir, "dom.json"),
    JSON.stringify({
      url: "https://www.bing.com/",
      title: "Bing",
      viewport: { w: 1220, h: 900 },
      documentHeight: 4356,
      truncated: false,
      nodes: [
        {
          i: 0,
          parent: null,
          depth: 0,
          tag: "section",
          rect: { x: 0, y: 880, w: 1220, h: 300 },
          style: { opacity: "0" },
        },
        {
          i: 1,
          parent: 0,
          depth: 1,
          tag: "span",
          text: "Which city is this?",
          rect: { x: 819, y: 909, w: 163, h: 40 },
          style: {},
        },
      ],
    }),
  );
  const manifest: CaptureManifest = {
    id: CAPTURE_ID,
    url: "https://www.bing.com/",
    finalUrl: "https://www.bing.com/",
    title: "Bing",
    capturedAt: new Date().toISOString(),
    viewport: { w: 1220, h: 900 },
    files: ["page.png", "dom.json", "snapshot.mhtml"],
    assetCount: 0,
    nodeCount: 2,
    themeOnly: false,
    captureVersion: 2,
    kind: "page",
    stateId: "frozen-state",
    stability: { status: "stable", attempts: 1 },
    geometry: {
      viewportCss: { width: 1220, height: 900 },
      documentCssHeight: 4356,
      scrollCss: { x: 0, y: 0 },
      devicePixelRatio: 2,
      screenshot: {
        mode: "full-page",
        bitmapWidth: 2440,
        bitmapHeight: 8712,
      },
      replay: { format: "mhtml", cssHeight: 4356, fidelity: "best-effort" },
    },
  };
  writeCaptureManifest(dir, manifest);

  const mcp = new McpServer({ name: "velloo", version: "0.1.0" });
  registerCaptureTools(mcp, t.ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "get-capture-test", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), mcp.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
  await cleanup();
  rmSync(home, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.VELLOO_HOME;
  else process.env.VELLOO_HOME = prevHome;
});

describe("get_capture", () => {
  test("returns openable paths, not bare filenames", async () => {
    const body = await callGetCapture();
    // The store lives under ~/.velloo, so an agent handed `["page.png"]` and
    // told to go find it searches the project tree and comes back empty.
    expect(body.dir).toBe(dir);
    const files = body.files as Array<{ name: string; path: string }>;
    expect(files.map((f) => f.name).sort()).toEqual(["dom.json", "page.png", "snapshot.mhtml"]);
    for (const f of files) expect(f.path).toBe(join(dir, f.name));
  });

  test("reports the screenshot's real dimensions", async () => {
    const body = await callGetCapture();
    const files = body.files as Array<Record<string, unknown>>;
    const png = files.find((f) => f.name === "page.png");
    expect(png).toMatchObject({ width: 2440, height: 8712 });
    const json = files.find((f) => f.name === "dom.json");
    expect(json).not.toHaveProperty("width");
    expect(body.geometry).toEqual({
      viewportCss: { width: 1220, height: 900 },
      documentCssHeight: 4356,
      scrollCss: { x: 0, y: 0 },
      devicePixelRatio: 2,
      screenshot: { mode: "full-page", bitmapWidth: 2440, bitmapHeight: 8712 },
      replay: { format: "mhtml", cssHeight: 4356, fidelity: "best-effort" },
    });
  });

  test("the note points at the screenshot and names the invisible nodes", async () => {
    const body = await callGetCapture();
    const note = body.note as string;
    expect(note).toContain("2440×8712");
    expect(note).toContain("HIDDEN");
    expect(body.outlineShown).toBe(2);
    const outline = body.outline as string[];
    expect(outline[0]).toContain("HIDDEN(opacity:0)");
    // The child is the line that used to read as ordinary page copy: it carries
    // its own `opacity: 1`, and its text and rect look entirely ordinary.
    expect(outline[1]).toContain(`"Which city is this?" [163×40 @819,909] HIDDEN`);
  });

  test("paginates and spatially filters computed nodes", async () => {
    const body = await callGetCapture({ full: true, yFrom: 900, limit: 1 });
    expect(body.nodes).toEqual([
      expect.objectContaining({ i: 0, rect: expect.objectContaining({ y: 880 }) }),
    ]);
    expect(body.nodeQuery).toEqual({ total: 2, returned: 1, offset: 0, nextOffset: 1 });

    const next = await callGetCapture({ full: true, yFrom: 900, limit: 1, offset: 1 });
    expect(next.nodes).toEqual([expect.objectContaining({ i: 1 })]);
  });

  test("labels page captures by capability", async () => {
    const body = await callGetCapture();
    expect(body.kind).toBe("page");
    expect(body.usableFor).toEqual(["theme-import", "outline", "comparison", "preview"]);
  });

  test("list_captures explains why a page capture exists and exposes its geometry", async () => {
    const res = await client.callTool({ name: "list_captures", arguments: {} });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? "{}";
    const body = JSON.parse(text) as {
      captures: Array<{ purpose: string; geometry?: { devicePixelRatio?: number } }>;
    };
    expect(body.captures[0]?.purpose).toContain("frozen page");
    expect(body.captures[0]?.geometry?.devicePixelRatio).toBe(2);
  });

  test("returns a bounded inline capture preview without importing it as an asset", async () => {
    writeFileSync(
      join(dir, "page.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const res = await client.callTool({
      name: "get_capture",
      arguments: { captureId: CAPTURE_ID, image: { mode: "overview", maxWidth: 400 } },
    });
    const content = res.content as Array<{ type: string; text?: string; data?: string }>;
    expect(content.some((item) => item.type === "image" && Boolean(item.data))).toBe(true);
    const body = JSON.parse(content.find((item) => item.type === "text")?.text ?? "{}") as {
      preview?: { mode?: string };
    };
    expect(body.preview?.mode).toBe("overview");
  });
});
