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
import { openSession } from "../../capture/sessions.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { errorResult, type McpResult } from "./result.ts";

function jsonResult(value: unknown): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/**
 * A readable digest of a DOM extract: the structural spine plus the repeated
 * blocks. The full `dom.json` can run to a thousand nodes, which is evidence
 * to read on demand — not something to push into an agent's context wholesale
 * on every `get_capture`.
 */
function outlineOf(dom: DomExtract, limit = 60): string[] {
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
    lines.push(`${indent}${n.tag}${rep}${text} [${n.rect.w}×${n.rect.h}]`);
  }
  return lines;
}

export function registerCaptureTools(mcp: McpServer, ctx: MutationContext): void {
  const folderId = (): string | undefined => ctx.folder.config.folderId;

  mcp.registerTool(
    "start_capture_session",
    {
      description:
        "Open a real browser window the USER drives, to reach pages you cannot: anything behind a login, a staging site, a third-party page you're taking direction from. The user logs in and navigates, and an in-page toolbar lets them capture any page — a screenshot, a structured DOM + computed-style extract, the page's CSS custom properties, and its images — all stored locally as evidence for you to work from. **Returns immediately with a sessionId; it does NOT wait for the session.** Poll `list_captures` to see captures as the user makes them. Use this when `compare_to_url` came back `unverified` with an auth wall, or when the user asks you to work from a site you can't reach. Then read the evidence with `get_capture` and verify your screen with `compare_to_url { captureId }` — a stored capture is authenticated and frozen, so it's a stable reference in a way a live auth-gated URL never is. You are NOT expected to mechanically convert the DOM into a tree: re-express the page in real components against the theme, exactly as for any code-to-design port.",
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
          note: "The browser window is open and the user is driving it. This call did NOT wait — poll list_captures for captures as they appear, and tell the user to hit 'Capture page' in the toolbar on each page you need, then 'Done'.",
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
        "Stored browser captures for this folder, newest first. Each entry's `captureId` can be read with `get_capture` and diffed against a screen with `compare_to_url { captureId }`. Captures come from `start_capture_session` or the user running `velloo capture`.",
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
      return jsonResult({
        captures,
        ...(captures.length === 0
          ? {
              note: "No captures yet. `start_capture_session` opens a browser for the user to log in and capture pages from.",
            }
          : {}),
      });
    },
  );

  mcp.registerTool(
    "get_capture",
    {
      description:
        "Read one stored capture: a structural outline of the page (with repeated blocks marked — those are your component candidates), the page's CSS custom properties as `import_theme`-ready CSS, and the list of downloaded image assets. Pass `full: true` for the complete node list with computed styles when the outline isn't enough. Use the theme CSS with `import_theme` BEFORE composing, so the page's real tokens resolve; then re-express the page with real components — do not transcribe the DOM node-for-node.",
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
        ...(dom
          ? full
            ? { documentHeight: dom.documentHeight, nodes: dom.nodes, truncated: dom.truncated }
            : {
                documentHeight: dom.documentHeight,
                outline: outlineOf(dom),
                nodeCount: dom.nodes.length,
                truncated: dom.truncated,
                note: "Outline only — pass full: true for every node with computed styles.",
              }
          : {}),
        ...(assets ? { assets: assets.assets } : {}),
        files: manifest.files,
        ...(manifest.files.includes("page.png")
          ? {
              verifyWith: `compare_to_url { screenId: "<your screen>", captureId: "${captureId}" }`,
            }
          : {}),
      });
    },
  );
}
