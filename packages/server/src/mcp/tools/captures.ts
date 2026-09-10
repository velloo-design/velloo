import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  captureDir,
  type DomExtract,
  HeadedBrowserMissingError,
  isSafeCaptureId,
  listCaptures,
  readCaptureManifest,
  type ThemeVars,
} from "@velloo/renderer";
import { z } from "zod";
import { emitActivity } from "../../activity.ts";
import { openSession, sessionStatuses } from "../../capture/sessions.ts";
import { pngSize } from "../../fs.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { errorResult, type McpResult } from "./result.ts";

function jsonResult(value: unknown): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/** Enough of a file to read a header from; empty when it isn't readable. */
function readBytes(path: string, length = 32): Buffer {
  try {
    return readFileSync(path).subarray(0, length);
  } catch {
    return Buffer.alloc(0);
  }
}

/**
 * Nodes the page lays out but a reader cannot see.
 *
 * The DOM walker already drops `display: none` and `visibility: hidden`, so
 * what survives to here is the harder case: `opacity: 0` (a hover-only panel,
 * a fade-in still waiting on script) and rects that sit outside the captured
 * page box. Opacity is NOT an inherited property — a child of a transparent
 * container computes its own `opacity: 1` — so the state has to be propagated
 * down, which is a single forward pass because the flat list is pre-order and
 * a parent therefore always precedes its children.
 *
 * Without this the *contents* of a hidden container read as ordinary page
 * copy, which is how a hover-only panel gets ported as a permanent card.
 */
function invisibleNodes(dom: DomExtract): { hidden: Set<number>; offscreen: Set<number> } {
  const hidden = new Set<number>();
  const offscreen = new Set<number>();
  for (const n of dom.nodes) {
    if (n.parent !== null && hidden.has(n.parent)) hidden.add(n.i);
    else if (n.style.opacity !== undefined && Number(n.style.opacity) === 0) hidden.add(n.i);
    // A full-page screenshot is viewport-wide, so anything wholly left of, above,
    // or right of that box is absent from the reference image whatever the DOM
    // says. `left: -9999px` and a carousel's off-stage slides both land here.
    const { x, y, w, h } = n.rect;
    if (x + w <= 0 || y + h <= 0 || x >= dom.viewport.w) offscreen.add(n.i);
  }
  return { hidden, offscreen };
}

interface Outline {
  lines: string[];
  shown: number;
  hiddenCount: number;
}

/**
 * A readable digest of a DOM extract: the structural spine plus the repeated
 * blocks. The full `dom.json` can run to a thousand nodes, which is evidence
 * to read on demand — not something to push into an agent's context wholesale
 * on every `get_capture`.
 *
 * Position and visibility ride along because without them the digest is not
 * merely thinner than the truth, it contradicts it: a size alone reads as flow
 * content, so a pill at (819, 909) above a carousel looks like a caption, and
 * a transparent panel looks like a card.
 */
export function outlineOf(dom: DomExtract, limit = 60): Outline {
  const { hidden, offscreen } = invisibleNodes(dom);
  const lines: string[] = [];
  for (const n of dom.nodes) {
    if (lines.length >= limit) break;
    const meaningful =
      n.repeat !== undefined ||
      (n.text !== undefined && n.text.length > 1) ||
      ["header", "nav", "main", "section", "footer", "aside", "form", "table"].includes(n.tag);
    if (!meaningful) continue;
    const indent = "  ".repeat(Math.min(n.depth, 8));
    const rep = n.repeat ? ` ×${n.repeat.count}` : "";
    const text = n.text ? ` "${n.text.slice(0, 60)}"` : "";
    const flags: string[] = [];
    // Name the cause on the node that owns it; a descendant carries the bare
    // marker, so the toggle to look for is the one line without a reason.
    if (hidden.has(n.i)) {
      flags.push(Number(n.style.opacity) === 0 ? "HIDDEN(opacity:0)" : "HIDDEN");
    }
    if (offscreen.has(n.i)) flags.push("OFFSCREEN");
    const marks = flags.length ? ` ${flags.join(" ")}` : "";
    const { x, y, w, h } = n.rect;
    lines.push(`${indent}${n.tag}${rep}${text} [${w}×${h} @${x},${y}]${marks}`);
  }
  return { lines, shown: lines.length, hiddenCount: hidden.size + offscreen.size };
}

export function registerCaptureTools(mcp: McpServer, ctx: MutationContext): void {
  const folderId = (): string | undefined => ctx.folder.config.folderId;

  mcp.registerTool(
    "start_capture_session",
    {
      description:
        "Open a real browser window the USER drives, to reach a page behind a login or on staging. Returns a sessionId IMMEDIATELY — never treat it as blocking and never re-call it to check; poll list_captures instead, and tell the user to log in, hit **Capture page** per page, then **Done**. Guide: velloo://guide/capture.",
      inputSchema: {
        url: z
          .string()
          .optional()
          .describe("Page to open the browser on. The session is scoped to this origin."),
      },
    },
    async ({ url }) => {
      if (url !== undefined) {
        let scheme: string;
        try {
          scheme = new URL(url).protocol;
        } catch {
          return errorResult(`Invalid url: ${url}`);
        }
        if (scheme !== "http:" && scheme !== "https:") {
          return errorResult(
            `start_capture_session: only http(s) URLs are allowed (got ${scheme})`,
          );
        }
      }
      try {
        const session = await openSession(ctx, {
          ...(url ? { url } : {}),
          onStatus: (message) => {
            console.error(`velloo capture: ${message}`);
          },
        });
        // Opening a browser the user is about to type real credentials into is
        // not a silent side effect: it lands in the canvas activity feed and on
        // the daemon's console, so a session an agent started is visible as one.
        emitActivity(ctx, "start_capture_session", {});
        console.error(
          `velloo capture: an agent opened a capture session${url ? ` on ${url}` : ""} — the browser window is yours to drive.`,
        );
        return jsonResult({
          sessionId: session.handle.sessionId,
          url: url ?? null,
          status: "open",
          note: "The browser window is open and the user is driving it. This call did NOT wait — poll list_captures, whose `sessions[]` reports whether the window is still open and what page the user is on, and tell them to hit 'Capture page' in the toolbar on each page you need, then 'Done'.",
        });
      } catch (err) {
        if (err instanceof HeadedBrowserMissingError) return errorResult(err.message);
        return errorResult(
          `start_capture_session failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );

  mcp.registerTool(
    "list_captures",
    {
      description:
        "Stored browser captures for this folder, newest first, plus the state of any capture session this daemon opened. Each `captureId` reads with `get_capture` and diffs against a screen with `compare_to_url { source: { captureId } }`. `sessions[]` says whether the user is still in the browser (`status`, `currentUrl`) — poll this rather than re-calling `start_capture_session`. Captures come from `start_capture_session` or `velloo capture`.",
      inputSchema: {},
    },
    async () => {
      const captures = listCaptures(ctx.folder.root, folderId()).map((m) => ({
        captureId: m.id,
        url: m.finalUrl || m.url,
        title: m.title,
        capturedAt: m.capturedAt,
        viewport: m.viewport,
        themeOnly: m.themeOnly,
        nodeCount: m.nodeCount,
        assetCount: m.assetCount,
      }));
      const sessions = sessionStatuses();
      const open = sessions.find((s) => s.status === "open");
      return jsonResult({
        captures,
        sessions,
        ...(open
          ? {
              note: `A capture session is open${open.currentUrl ? ` on ${open.currentUrl}` : ""}. The user drives it: ask them to reach each page you need and hit 'Capture page', then 'Done'. Poll this tool — do not call start_capture_session again.`,
            }
          : captures.length === 0
            ? {
                note: sessions.length
                  ? "The capture session has closed and produced nothing. Ask the user whether they hit 'Capture page' before 'Done', then start another session."
                  : "No captures yet. `start_capture_session` opens a browser for the user to log in and capture pages from.",
              }
            : {}),
      });
    },
  );

  mcp.registerTool(
    "get_capture",
    {
      description:
        "Read one stored capture: a structural outline of the page — every line carrying its rect as `[w×h @x,y]` and a HIDDEN / OFFSCREEN marker where the node lays out but cannot be seen — plus repeated blocks marked (your component candidates), its CSS custom properties as `import_theme`-ready CSS, and the downloaded image assets. `files` gives absolute paths: **open `page.png`, it is the authoritative reference and the outline is a digest of it.** `full: true` returns every node with computed styles. Feed the theme CSS to `import_theme` BEFORE composing. Guide: velloo://guide/capture.",
      inputSchema: {
        captureId: z.string(),
        full: z
          .boolean()
          .optional()
          .describe("Return every extracted node with computed styles (large). Default false."),
      },
    },
    async ({ captureId, full }) => {
      if (!isSafeCaptureId(captureId)) return errorResult(`Invalid captureId: ${captureId}`);
      const manifest = readCaptureManifest(ctx.folder.root, captureId, folderId());
      if (!manifest) {
        return errorResult(`No capture "${captureId}" for this folder — call list_captures.`);
      }
      const dir = captureDir(ctx.folder.root, captureId, folderId());
      const readJson = <T>(file: string): T | null => {
        try {
          return JSON.parse(readFileSync(join(dir, file), "utf8")) as T;
        } catch {
          return null;
        }
      };
      const theme = readJson<ThemeVars>("computed-vars.json");
      const dom = manifest.themeOnly ? null : readJson<DomExtract>("dom.json");
      const assets = readJson<{ assets: Array<{ url: string; file: string }> }>("assets.json");
      const outline = dom ? outlineOf(dom) : null;
      // A bare filename is unopenable: the store lives under ~/.velloo, not in
      // the design folder, so an agent that goes looking for `page.png` from
      // the project searches the wrong tree. Hand back the paths.
      const files = manifest.files.map((name) => {
        const path = join(dir, name);
        const size = name.endsWith(".png") ? pngSize(readBytes(path)) : null;
        return { name, path, ...(size ?? {}) };
      });
      const screenshot = files.find((f) => f.name === "page.png");

      return jsonResult({
        captureId,
        url: manifest.finalUrl || manifest.url,
        title: manifest.title,
        capturedAt: manifest.capturedAt,
        viewport: manifest.viewport,
        themeOnly: manifest.themeOnly,
        ...(theme
          ? {
              themeCss: theme.css,
              fonts: theme.fonts,
              tokenCount: Object.keys(theme.light).length + Object.keys(theme.dark).length,
            }
          : {}),
        ...(dom && outline
          ? full
            ? { documentHeight: dom.documentHeight, nodes: dom.nodes, truncated: dom.truncated }
            : {
                documentHeight: dom.documentHeight,
                outline: outline.lines,
                outlineShown: outline.shown,
                nodeCount: dom.nodes.length,
                truncated: dom.truncated,
                note:
                  `Digest of ${outline.shown} of ${dom.nodes.length} nodes — rects are ` +
                  `\`[w×h @x,y]\` in page coordinates. ` +
                  (outline.hiddenCount > 0
                    ? `${outline.hiddenCount} node(s) are marked HIDDEN or OFFSCREEN: they lay out but do not appear in page.png, so a hover-only or off-stage block is NOT ordinary page content — model it as such or leave it out. `
                    : "") +
                  (screenshot
                    ? `page.png (${screenshot.width}×${screenshot.height}) is the authoritative reference — open it. `
                    : "") +
                  `Pass full: true for every node with computed styles.`,
              }
          : {}),
        ...(assets ? { assets: assets.assets } : {}),
        dir,
        files,
        ...(screenshot
          ? {
              verifyWith: `compare_to_url { screenId: "<your screen>", source: { captureId: "${captureId}" } }`,
            }
          : {}),
      });
    },
  );
}
