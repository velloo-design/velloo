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

async function callGetCapture(): Promise<Record<string, unknown>> {
  const res = await client.callTool({ name: "get_capture", arguments: { captureId: CAPTURE_ID } });
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
    files: ["page.png", "dom.json"],
    assetCount: 0,
    nodeCount: 2,
    themeOnly: false,
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
    expect(files.map((f) => f.name).sort()).toEqual(["dom.json", "page.png"]);
    for (const f of files) expect(f.path).toBe(join(dir, f.name));
  });

  test("reports the screenshot's real dimensions", async () => {
    const files = (await callGetCapture()).files as Array<Record<string, unknown>>;
    const png = files.find((f) => f.name === "page.png");
    expect(png).toMatchObject({ width: 2440, height: 8712 });
    const json = files.find((f) => f.name === "dom.json");
    expect(json).not.toHaveProperty("width");
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
});
