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
        "Read one stored capture: a structural outline of the page with repeated blocks marked (your component candidates), its CSS custom properties as `import_theme`-ready CSS, and the downloaded image assets. `full: true` returns every node with computed styles. Feed the theme CSS to `import_theme` BEFORE composing. Guide: velloo://guide/capture.",
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
              verifyWith: `compare_to_url { screenId: "<your screen>", source: { captureId: "${captureId}" } }`,
            }
          : {}),
      });
    },
  );
}
