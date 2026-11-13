import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { type FrameworkAdapter, styleChannelOf } from "@velloo/provider";
import { withActor } from "../activity.ts";
import type { CloudAuth } from "../cloud.ts";
import { designSystemDoc } from "../design-system.ts";
import { hostHasApp } from "../host-app.ts";
import type { CanvasBundler } from "../live/canvas-bundler.ts";
import type { LiveBundler } from "../live/component-bundler.ts";
import type { LocalCommentsService } from "../local-comments.ts";
import type { MutationContext } from "../mutations/index.ts";
import { buildingBlocks } from "../repo/catalog.ts";
import { requestIsLocal } from "../security.ts";
import type { TailwindJit } from "../styles/tailwind-jit.ts";
import { type JavaScriptTheme, javaScriptTheme } from "../theme/theme-source.ts";
import { MCP_SERVER_INFO } from "../version.ts";
import {
  designsInstruction,
  parseMcpSessionUrl,
  type SessionDesigns,
  sessionDesigns,
} from "./designs.ts";
import { registerGuideResources } from "./resources.ts";
import {
  applyMcpToolSurface,
  DEFAULT_MCP_SURFACE,
  type McpSurfaceSelection,
  parseMcpSurfaceUrl,
} from "./surface.ts";
import { applyToolPolicy } from "./tool-policy.ts";
import { registerAssetTools } from "./tools/assets.ts";
import { registerBatchTool } from "./tools/batch.ts";
import { registerCaptureTools } from "./tools/captures.ts";
import { registerCommentTools } from "./tools/comments.ts";
import { registerComposeTool } from "./tools/compose.ts";
import { registerDesignLanguageTools } from "./tools/design-language.ts";
import { registerDesignTools } from "./tools/designs.ts";
import { registerDiscoveryTools } from "./tools/discovery.ts";
import { registerEmitTools } from "./tools/emit.ts";
import { registerExtensionTools } from "./tools/extensions.ts";
import { registerFeedbackTool } from "./tools/feedback.ts";
import { registerGenerateTools } from "./tools/generate.ts";
import { registerHostFileTools } from "./tools/host-files.ts";
import { registerInspectTool } from "./tools/inspect.ts";
import { registerLookTools } from "./tools/looks.ts";
import { registerMutationTools } from "./tools/mutations.ts";
import { registerNoteTools } from "./tools/notes.ts";
import { registerRepoTools } from "./tools/repo.ts";
import { registerScreenshotTool } from "./tools/screenshot.ts";
import { registerSketchbookTools } from "./tools/sketchbook.ts";
import { registerThemeTools } from "./tools/theme.ts";
import { createTraceRecorder, withCallRecording } from "./trace.ts";

export interface McpServerOptions {
  port: number;
  host: string;
  jit: TailwindJit;
  bundler: LiveBundler;
  canvasBundler: CanvasBundler;
  comments: LocalCommentsService;
  /** Canvas-server origin, used as <base href> in screenshot renders so /assets/* resolve. */
  assetOrigin?: string | undefined;
  /**
   * velloo-cloud credentials, resolved by the CLI and threaded in. Enables
   * the opt-in `send_feedback` tool. Absent ⇒ no cloud calls.
   */
  cloud?: CloudAuth | undefined;
}

export interface McpServerHandle {
  url: string;
  port: number;
  /**
   * Live MCP sessions of clients outside the daemon — feeds its idle-shutdown
   * check. An Agent-tab agent's session is left out: the daemon stops that
   * agent itself, and an idle one never ends its session.
   */
  sessions(): number;
  close(): Promise<void>;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  inCanvas: boolean;
}

/** The setup paragraph's theme step: confirm what init imported, the way that fits where it came from. */
function setupThemeStep(js: JavaScriptTheme | null): string {
  if (!js)
    return "Confirm the theme and fonts `velloo init` imported (`import_theme { cssPath }`, its `notImported`).";
  if (js.file)
    return `\`velloo init\` read the app's theme from \`${js.file}\`: compare \`get_theme\` with it and \`set_theme\` what differs.`;
  if (js.defaults)
    return `The app sets no theme, so the design is on ${js.defaults}'s: \`set_theme\` what the app changes.`;
  return "The app is themed in JavaScript: compare `get_theme` with its theme object and `set_theme` what differs.";
}

/**
 * How much of a server's instructions Claude Code shows the model: it cuts
 * them at this many characters and says nothing about the rest. Every brief
 * `buildInstructions` can write fits — the test enumerates them — so nothing a
 * session needs is past the cut. A framework's detail and an app recipe's notes
 * arrive with `list_components`' index instead, which the brief sends the agent
 * to first.
 */
export const VISIBLE_INSTRUCTION_CHARS = 2048;

/**
 * Say a screen's diagnostics once, then only when they change. Every write and
 * every capture carries them — which is right the first time and noise after:
 * a run that compares four times was handed the same dozen `theme/raw-color`
 * lines four times, some 40% of each result. An unchanged set is replaced by
 * its count; any change sends the whole set again.
 */
export function withDiagnosticsOnce(mcp: McpServer): McpServer {
  const original = mcp.registerTool.bind(mcp);
  const sent = new Map<string, string>();
  const patched: typeof original = (name, config, cb) => {
    const handler = cb as (args: unknown, extra: unknown) => unknown;
    const wrapped = async (args: unknown, extra: unknown): Promise<unknown> => {
      const result = await handler(args, extra);
      const given = (args ?? {}) as { screenId?: unknown; snippetId?: unknown };
      const subject = given.screenId ?? given.snippetId;
      const content = (result as { content?: unknown } | null)?.content;
      const first = Array.isArray(content)
        ? (content[0] as { type?: string; text?: string })
        : null;
      if (typeof subject !== "string" || first?.type !== "text" || !first.text?.startsWith("{")) {
        return result;
      }
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(first.text) as Record<string, unknown>;
      } catch {
        return result;
      }
      if (!Array.isArray(body.diagnostics) || body.diagnostics.length === 0) return result;
      const set = JSON.stringify(body.diagnostics);
      if (sent.get(subject) !== set) {
        sent.set(subject, set);
        return result;
      }
      const { diagnostics, ...rest } = body;
      const text = JSON.stringify({
        ...rest,
        diagnosticsUnchanged: `the same ${(diagnostics as unknown[]).length} as in the last result for "${subject}"`,
      });
      return {
        ...(result as object),
        content: [{ type: "text", text }, ...(content as unknown[]).slice(1)],
      };
    };
    return original(name, config, wrapped as typeof cb);
  };
  (mcp as { registerTool: typeof original }).registerTool = patched;
  return mcp;
}

/**
 * The always-resident boot guidance.
 *
 * Scoped deliberately: this carries only what no single tool description can —
 * the mental model and the efficiency contract that governs how MANY calls a
 * session makes. Everything task-specific lives in a `velloo://guide/*`
 * resource (see resources.ts), a tool's description or `list_components`'
 * index. Adding a sentence here taxes every session forever, and the brief has
 * to fit VISIBLE_INSTRUCTION_CHARS with every optional paragraph present.
 */
const INTRO_LINE =
  "This is a Velloo design folder: a code-shaped canvas of the project's real components.";

const BIG_STROKES =
  'Read `list_components` and `get_theme` first. `compose` takes the JSX you\'d write for the app (`const` data, `.map`, `cond && <X />`, a page `file`); `get_screen { mode: "jsx" }` reads it back.';

const FINISH =
  "Prefer theme tokens and library families to `Box` stacks, `screenshot` before calling it done, hand off with `emit_code`. Guides: the `velloo://guide/*` resources.";

const FULL_HEAD = [
  INTRO_LINE,
  "**Never edit the design folder's files by hand** — every change goes through these tools.",
  `**Build in big strokes** — a few dozen calls a screen, not hundreds. ${BIG_STROKES} ${FINISH}`,
];

const GUIDED_HEAD = [
  INTRO_LINE,
  "**Never edit the design folder's files by hand**: write with `call_velloo` (`run_velloo_plan`, up to eight), read with `read_velloo`.",
  `**Build in big strokes.** ${BIG_STROKES} ${FINISH}`,
];

/** Mirrors the consent rules in `send_feedback`'s description, which the guided surface hides. */
const FEEDBACK_INSTRUCTION =
  "**Feedback on Velloo itself**: `send_feedback`, only once the user approves the exact `body`, with none of their design, code or paths.";

export interface BriefOptions {
  feedbackEnabled?: boolean;
  /** Where the canvas is, for the user to watch: the stdio transport binds a port no one can predict. */
  canvasUrl?: string | undefined;
  /** The adapter's paragraph (`FrameworkAdapter.mcpIntro`); absent ⇒ the neutral brief. */
  intro?: string | undefined;
  /** The app has components of its own to build with (or may: its catalog wasn't read in time). */
  appComponents?: boolean;
  openComments?: number;
  /** The design is bound to an app that exists. */
  hasApp?: boolean;
  /** No boards yet. */
  bare?: boolean;
  surface?: McpSurfaceSelection;
  designs?: SessionDesigns | null;
  designSystemPath?: string | null;
  /** Where an app themed in JavaScript keeps its theme; null for one themed in CSS. */
  javaScriptAppTheme?: JavaScriptTheme | null;
  /** The agent runs in the canvas's Agent tab: the person is looking at the canvas already. */
  inCanvas?: boolean;
}

/** The app's own components; setup checks them already, so only a set-up design is told how. */
function appComponentsParagraph(setup: boolean): string {
  const check = setup ? "" : " Check them once: `preview_status`, then `check_components`.";
  return `**Build with the app's own components first** (Repo shelves in \`list_components\`), never the whole page or \`App\` as one node.${check}`;
}

/**
 * The instructions string, most important first. Every combination of the
 * options fits VISIBLE_INSTRUCTION_CHARS (the test enumerates them), so
 * nothing here may grow without something else giving way.
 */
export function buildInstructions(options: BriefOptions = {}): string {
  const guided = (options.surface ?? { mode: "full" }).mode === "guided";
  const parts: string[] = [];
  const add = (...paragraph: string[]) => parts.push(paragraph.join("\n"));
  // Which design, of several, comes before anything about how to work on it.
  if (options.designs) add(...designsInstruction(options.designs));
  for (const paragraph of guided ? GUIDED_HEAD : FULL_HEAD) add(paragraph);
  if (options.inCanvas) {
    add(
      "**You are running in the Velloo canvas's Agent tab**: the user sees every edit render; send no URL.",
    );
  } else if (options.canvasUrl) {
    add(`**The live canvas** is at ${options.canvasUrl} — give the user this URL up front.`);
  }
  const open = options.openComments ?? 0;
  if (open > 0) {
    // Named as operations rather than tools: on the guided surface they are
    // reachable only through the façade.
    const one = open === 1;
    add(
      `**${one ? "1 open feedback thread is" : `${open} open feedback threads are`} waiting on you.** Read ${one ? "it" : "them"} (\`list_comment_threads\`), make the ${one ? "change" : "changes"}, reply and resolve (\`update_comment_thread\`).`,
    );
  }
  if (options.designSystemPath) {
    add(
      `**This folder follows \`${options.designSystemPath}\`**, a design system document: read it before composing or reviewing; it outranks generic defaults.`,
    );
  }
  const setup = Boolean(options.bare && options.hasApp);
  if (setup) {
    // A design just made for an app that exists: nothing drawn yet, so this is
    // the one moment setting it up costs nothing to redo.
    add(
      `**Set this design up for its app first** (velloo://guide/porting, or the velloo-setup skill). ${setupThemeStep(options.javaScriptAppTheme ?? null)} Then \`preview_status\`, \`check_components\`, and \`set_design_language\` for the user to review.`,
    );
  } else if (options.bare) {
    add(
      '**Bare folder.** No boards yet: set the theme first (`set_theme`), or find a look in a sketchbook (velloo://guide/sketchbook). `compose` mode "replace" on a new screenId creates a screen and its board.',
    );
  }
  // The framework's own framing: the vocabulary and the style channel are what
  // a compose most needs to get right.
  if (options.intro) add(options.intro);
  if (options.appComponents) add(appComponentsParagraph(setup));
  if (options.hasApp && !setup) {
    add(
      "**Matching an existing app:** start it yourself (Velloo never runs it) and iterate with `compare_to_url`, fixing `topMismatches` in order; if it can't run, say what's missing rather than design from memory.",
    );
  }
  if (options.feedbackEnabled) add(FEEDBACK_INSTRUCTION);
  return parts.join("\n\n");
}

export interface SessionServerOptions {
  jit: TailwindJit;
  bundler: LiveBundler;
  canvasBundler: CanvasBundler;
  comments: LocalCommentsService;
  assetOrigin?: string | undefined;
  cloud?: CloudAuth | undefined;
  surface?: McpSurfaceSelection | undefined;
  designs?: SessionDesigns | null | undefined;
  /** Whether the app has components of its own to build with; null where unknown. */
  appComponents?: boolean | null | undefined;
  inCanvas?: boolean | undefined;
}

/**
 * One session's server: its brief and every tool it advertises. The daemon's
 * HTTP and stdio transports build through this, and so does the MCP budget
 * script — so what the budget measures is the surface a session is handed.
 */
export function buildMcpServer(ctx: MutationContext, opts: SessionServerOptions): McpServer {
  const { jit, bundler, canvasBundler, comments, assetOrigin, cloud } = opts;
  const surface = opts.surface ?? DEFAULT_MCP_SURFACE;
  const designs = opts.designs ?? null;
  const appComponents = opts.appComponents ?? null;
  const inCanvas = opts.inCanvas ?? false;
  // Opt-in AND reachable: with no cloud configured the tool could never do
  // anything, so neither it nor its instruction paragraph is worth a session's
  // context.
  const feedbackEnabled = Boolean(ctx.folder.config.feedback?.enabled && cloud?.url);
  // Framework framing comes from the adapter itself (its style channel picks
  // the variant for multi-channel providers) — no provider ids here.
  const channel = styleChannelOf(ctx.defaultProvider, ctx.folder.config.styling?.framework);
  const bare = ctx.folder.boards.size === 0;
  const hasApp = hostHasApp(ctx);
  const instructions = buildInstructions({
    feedbackEnabled,
    canvasUrl: assetOrigin && trimTrailingSlashes(assetOrigin),
    intro: (ctx.defaultProvider as FrameworkAdapter).mcpIntro?.(channel.kind),
    appComponents: buildsWithAppComponents(ctx, appComponents),
    // Synchronous local state only: initializing an agent session never needs
    // a network call. Shared threads are folded into this service when synced.
    openComments: comments.countOpenSync(),
    hasApp,
    bare,
    surface,
    designs,
    designSystemPath: designSystemDoc(ctx.folder)?.path ?? null,
    javaScriptAppTheme: javaScriptAppTheme(ctx),
    inCanvas,
  });
  const mcp = new McpServer(MCP_SERVER_INFO, { instructions });
  // Installed before policy and tracing: native registrations flow through all
  // wrappers, then the selected surface disables or replaces their public view.
  const toolSurface = applyMcpToolSurface(mcp, surface, () =>
    [...ctx.folder.boards.values()].flatMap((board) =>
      board.frames.map((frame) => ({
        boardId: board.id,
        frameId: frame.id,
        screenId: frame.screen,
      })),
    ),
  );
  // Before any tool registers: strict input shapes (a typo'd argument fails
  // loudly with the valid keys instead of being silently dropped) and the
  // behavioural annotations a host reads to decide what to auto-approve.
  applyToolPolicy(mcp);
  // Hidden, env-gated session tape (VELLOO_TRACE). Wrap after the policy patch
  // so every handler is taped; no-op when the flag is unset.
  const recorder = createTraceRecorder(ctx.folder.root);
  if (recorder) withCallRecording(mcp, recorder);
  // Innermost, so the tape shows the result as the agent received it.
  withDiagnosticsOnce(mcp);
  registerDiscoveryTools(mcp, ctx);
  registerComposeTool(mcp, ctx, jit);
  registerMutationTools(mcp, ctx, jit);
  registerInspectTool(mcp, ctx, jit, bundler, canvasBundler, assetOrigin);
  registerThemeTools(mcp, ctx);
  registerDesignLanguageTools(mcp, ctx, assetOrigin && trimTrailingSlashes(assetOrigin));
  registerEmitTools(mcp, ctx, jit);
  registerScreenshotTool(mcp, ctx, jit, bundler, canvasBundler, assetOrigin);
  // Only a folder styled by the app's own files pays for the tool.
  if (Object.values(ctx.providers).some((p) => (p as FrameworkAdapter).hostStylesheets)) {
    registerHostFileTools(mcp, ctx);
  }
  registerRepoTools(mcp, ctx, jit, bundler, canvasBundler, assetOrigin);
  registerExtensionTools(mcp, ctx);
  registerNoteTools(mcp, ctx);
  registerAssetTools(mcp, ctx);
  registerBatchTool(mcp, ctx, jit);
  registerCaptureTools(mcp, ctx);
  // Opt-in, auth-gated. The credential may be absent (logged out) or go stale
  // mid-session, so the tool checks at call time and reports a kinded
  // `signed-out` error the agent can act on.
  if (feedbackEnabled && cloud) registerFeedbackTool(mcp, ctx, cloud);
  registerCommentTools(mcp, comments);
  // Hosted generation: quota/feature failures return actionable messages.
  registerGenerateTools(mcp, ctx, cloud ?? { url: "" });
  registerSketchbookTools(mcp, ctx, cloud, assetOrigin && trimTrailingSlashes(assetOrigin));
  registerLookTools(mcp, ctx);
  if (designs) registerDesignTools(mcp, ctx, designs);
  toolSurface.finish();
  // Long-form guides live here rather than in tool descriptions: fetched on
  // demand, so a session pays one listing line instead of the whole manual.
  registerGuideResources(mcp);
  return mcp;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) return undefined;
  return JSON.parse(raw);
}

function isInitializeRequest(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  // JSON-RPC initialize can be either a single message or a batched array.
  const messages = Array.isArray(body) ? body : [body];
  return messages.some(
    (m) =>
      m && typeof m === "object" && (m as { method?: string | undefined }).method === "initialize",
  );
}

function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
}

export async function createMcpServer(
  ctx: MutationContext,
  opts: McpServerOptions,
): Promise<McpServerHandle> {
  /** Per-session state. One McpServer + one transport per session, per the SDK's Protocol contract. */
  const sessions = new Map<string, Session>();

  const httpServer: HttpServer = createHttpServer(async (req, res) => {
    // The same loopback guard the canvas API applies. Without it a DNS-rebound
    // page is same-origin with this port and reaches every mutating tool.
    if (!requestIsLocal({ host: req.headers.host, origin: req.headers.origin })) {
      sendJson(res, 403, { error: "forbidden: request is not from a local origin" });
      return;
    }
    if (!req.url?.startsWith("/mcp")) {
      sendJson(res, 404, { error: "expected /mcp" });
      return;
    }

    const sessionId = req.headers["mcp-session-id"];
    const sessionIdStr = Array.isArray(sessionId) ? sessionId[0] : sessionId;

    try {
      if (req.method === "POST") {
        const body = await readBody(req);
        let session = sessionIdStr ? sessions.get(sessionIdStr) : undefined;

        if (!session) {
          if (!isInitializeRequest(body)) {
            sendJson(res, 400, {
              error: "missing or unknown mcp-session-id; send `initialize` first",
            });
            return;
          }
          // Fresh session: build a dedicated McpServer + transport pair.
          const sessionOptions = parseMcpSessionUrl(req.url);
          const { inCanvas } = sessionOptions;
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: (id) => {
              sessions.set(id, { transport, server, inCanvas });
            },
          });
          const parsedSurface = parseMcpSurfaceUrl(req.url);
          if (!parsedSurface.ok) {
            sendJson(res, 400, { error: parsedSurface.error });
            return;
          }
          const server = buildMcpServer(ctx, {
            ...opts,
            surface: parsedSurface.selection,
            designs: await sessionDesigns(ctx.folder.root, ctx.folder.config.name, sessionOptions),
            appComponents: await appHasComponents(ctx),
            inCanvas: sessionOptions.inCanvas,
          });
          transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
            void server.close().catch(() => undefined);
          };
          // The SDK's own `Transport` declares `onclose?: () => void` while
          // its `StreamableHTTPServerTransport` implements it as
          // `(() => void) | undefined` — internally inconsistent under
          // exactOptionalPropertyTypes. The value is the SDK's own transport;
          // only its declaration disagrees with itself.
          await server.connect(transport as Parameters<typeof server.connect>[0]);
          session = { transport, server, inCanvas };
        }

        // Actor attribution: every mutation this request triggers is
        // agent activity, tagged with the MCP session. AsyncLocalStorage
        // carries it into the tool handlers without threading a param.
        const active = session;
        await withActor(
          { source: "mcp", session: sessionIdStr ?? active.transport.sessionId },
          () => active.transport.handleRequest(req, res, body),
        );
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        if (!sessionIdStr || !sessions.has(sessionIdStr)) {
          sendJson(res, 400, { error: "missing or unknown mcp-session-id" });
          return;
        }
        const session = sessions.get(sessionIdStr);
        if (!session) {
          sendJson(res, 400, { error: "session lost" });
          return;
        }
        await session.transport.handleRequest(req, res);
        return;
      }

      sendJson(res, 405, { error: `method ${req.method} not allowed` });
    } catch (err) {
      console.error("velloo mcp: handler failed:", err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal error" });
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(opts.port, opts.host, () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });

  const addr = httpServer.address();
  const boundPort =
    typeof addr === "object" && addr !== null && "port" in addr ? addr.port : opts.port;

  return {
    url: `http://${opts.host}:${boundPort}/mcp`,
    port: boundPort,
    sessions: () => [...sessions.values()].filter((s) => !s.inCanvas).length,
    async close() {
      // Close all sessions first, then the listener.
      for (const session of sessions.values()) {
        await session.transport.close().catch(() => undefined);
        await session.server.close().catch(() => undefined);
      }
      sessions.clear();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

export interface StdioMcpServerOptions {
  jit: TailwindJit;
  bundler: LiveBundler;
  canvasBundler: CanvasBundler;
  comments: LocalCommentsService;
  /** Canvas-server origin, used as <base href> in screenshot renders so /assets/* resolve. */
  assetOrigin?: string | undefined;
  cloud?: CloudAuth | undefined;
  surface?: McpSurfaceSelection | undefined;
}

export interface StdioMcpServerHandle {
  close(): Promise<void>;
}

/**
 * MCP over stdio: the agent spawns `velloo mcp` and talks to this process's
 * stdin/stdout. One server, one session — there's no multiplexing on a pipe,
 * unlike the HTTP transport. Nothing else may write to stdout or the JSON-RPC
 * stream corrupts; all diagnostics go to stderr.
 */
export async function createStdioMcpServer(
  ctx: MutationContext,
  opts: StdioMcpServerOptions,
): Promise<StdioMcpServerHandle> {
  const server = buildMcpServer(ctx, {
    ...opts,
    // In-process stdio has no proxy to carry the session to another daemon.
    designs: await sessionDesigns(ctx.folder.root, ctx.folder.config.name, {
      switchable: false,
      pick: undefined,
      inCanvas: false,
    }),
    appComponents: await appHasComponents(ctx),
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return {
    async close() {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    },
  };
}

/**
 * The app's own components, stated up front when the design is bound to an
 * app: they are the first thing to reach for, and they need one setup step.
 * Synchronous on purpose (session start never waits on discovery), so it
 * speaks about the capability and the recipes found, not the catalog itself.
 */
/**
 * Whether the app has components of its own to design with, for the brief —
 * or null where that isn't known in time. Reading the catalog walks the app's
 * source, so a session never waits long on it: unknown reads as "it may have".
 */
async function appHasComponents(ctx: MutationContext): Promise<boolean | null> {
  if (!ctx.repo) return null;
  const waited = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), 1500).unref?.();
  });
  const catalog = await Promise.race([ctx.repo.catalog().catch(() => null), waited]);
  return catalog ? buildingBlocks(catalog).length > 0 : null;
}

/**
 * Is there an app here to set the design up for? A package manifest at the
 * host root says so for anything Node; a server-rendered app has none, and is
 * known by the adapter that styles the design from the app's own stylesheets.
 */
/**
 * Where the app keeps its theme, when that is JavaScript: what init recorded,
 * else — for a design with no record, or one that started on a preset because
 * nothing was read — a framework whose theme is a JavaScript object (an
 * adapter or a recipe with a theme module). Null for an app themed in CSS.
 */
function javaScriptAppTheme(ctx: MutationContext): JavaScriptTheme | null {
  const source = ctx.folder.config.themeSource;
  const recorded = javaScriptTheme(source);
  if (recorded) return recorded;
  if ((source && source.kind !== "preset") || !hostHasApp(ctx)) return null;
  const themedInJs =
    (ctx.defaultProvider as FrameworkAdapter).themeModule !== undefined ||
    (ctx.repo?.recipes(undefined).length ?? 0) > 0;
  return themedInJs ? {} : null;
}

/**
 * Whether the brief sends the agent to the app's own components: a Node app
 * that has some to build with, or may have (the catalog wasn't read in time),
 * or that a recipe renders. One with only pages and a router gets nothing — the
 * paragraph would send the agent to check a preview entry no screen will use.
 */
function buildsWithAppComponents(ctx: MutationContext, appComponents: boolean | null): boolean {
  const repo = ctx.repo;
  if (!repo) return false;
  if (!existsSync(join(repo.host(undefined).hostRoot, "package.json"))) return false;
  return appComponents !== false || repo.recipes(undefined).length > 0;
}
