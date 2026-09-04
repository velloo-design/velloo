import { randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { detectTailwindMajor } from "@velloo/codegen";
import { type FrameworkAdapter, styleChannelOf } from "@velloo/provider";
import { withActor } from "../activity.ts";
import type { CloudAuth } from "../cloud.ts";
import { hostAppRootFrom } from "../live/bundle-core.ts";
import type { CanvasBundler } from "../live/canvas-bundler.ts";
import type { LiveBundler } from "../live/component-bundler.ts";
import type { LocalCommentsService } from "../local-comments.ts";
import type { MutationContext } from "../mutations/index.ts";
import type { TailwindJit } from "../styles/tailwind-jit.ts";
import { registerGuideResources } from "./resources.ts";
import { applyToolPolicy } from "./tool-policy.ts";
import { registerAssetTools } from "./tools/assets.ts";
import { registerBatchTool } from "./tools/batch.ts";
import { registerCaptureTools } from "./tools/captures.ts";
import { registerCatalogTools } from "./tools/catalog.ts";
import { registerCommentTools } from "./tools/comments.ts";
import { registerDiscoveryTools } from "./tools/discovery.ts";
import { registerEmitTools } from "./tools/emit.ts";
import { registerExtensionTools } from "./tools/extensions.ts";
import { registerFeedbackTool } from "./tools/feedback.ts";
import { registerGenerateTools } from "./tools/generate.ts";
import { registerInspectTool } from "./tools/inspect.ts";
import { registerMutationTools } from "./tools/mutations.ts";
import { registerNoteTools } from "./tools/notes.ts";
import { registerScreenshotTool } from "./tools/screenshot.ts";
import { registerThemeTools } from "./tools/theme.ts";
import { registerValidateTools } from "./tools/validate.ts";
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
  /** Count of live MCP sessions — feeds the daemon's idle-shutdown check. */
  sessions(): number;
  close(): Promise<void>;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

/**
 * The always-resident boot guidance.
 *
 * Scoped deliberately: this carries only what no single tool description can —
 * the mental model, the three customization layers, and the efficiency contract
 * that governs how MANY calls a session makes. Everything task-specific lives in
 * a `velloo://guide/*` resource (see resources.ts) and is fetched on demand, so
 * a session that never ports an app never pays for the porting manual. Adding a
 * paragraph here taxes every session forever — check whether it belongs in a
 * guide or a tool description first.
 */
const INSTRUCTION_PARTS = [
  "You are working on a Velloo design folder: a code-shaped design canvas whose components are the project's real component library. Designs are static — click handlers, routing and forms are no-ops.",
  "",
  "**The design folder is tool-owned.** Screens, boards, snippets and the theme live as JSON files inside it, but never read or edit those files by hand — every operation goes through these tools, which hold the write lock, validation and history. The user can watch the design render live with `velloo run`.",
  "",
  '**Start by reading, once.** `list_components` (mode "summary"; full mode includes a working `example` per component — copy it, then adapt), `get_theme` for the palette and tokens, `list_snippets` to reuse before defining, `list_boards` for the boards and their frames. For an existing screen, `get_screen mode: "outline"` before pulling the full JSON.',
  "",
  "**Three customization layers** stack additively:",
  "  - **Libraries** are the baseline component palette. A folder registers N (`config.libraries`); each screen pins one via `screen.library`, and component ids resolve against that library only.",
  "  - **Extensions** add wholly new components the library doesn't have — the app's own `DataTable`, a brand `Hero`. Register with `add_extension`; they emit a real import. Additive customization, NOT compositions.",
  '  - **Snippets** compose existing components into named subtrees with typed params — the tool for repeated structure (FeatureCard, NavRow, PricingTier). Reference one with a `{"$snippet":"<kebab-id>"}` node, NOT `$ref` (which is only for PascalCase library components and extensions).',
  "",
  "**Styling is framework-native.** `update_props`'s `style` channel routes your payload to whatever the screen's framework uses — a Tailwind `className` string, an `sx` object, or a plain `style` object — so one verb works everywhere. Prefer theme tokens over hard-coded values in any channel; on a Tailwind folder prefer semantic tokens (`bg-background`, `text-muted-foreground`, `bg-primary`) over raw palette colors, because only semantic tokens theme-flip in dark mode.",
  "",
  "**EFFICIENCY — build in big strokes, read once.** A screen should take a few dozen tool calls, not hundreds; over-calling is the most common failure. (1) **`children` arrays are the default mental model** — `add_node` accepts a full subtree, so build a whole feature card in ONE call rather than node-by-node. (2) **`batch` groups a sequence of mutations into one round-trip**, atomic by default: on the first error every touched resource rolls back and the result reports `rolledBack: true` with the failing call. Use it instead of firing one tiny mutation per node. (3) **Work from memory** — do NOT re-`get_screen` or re-`list_boards` before every edit; to re-locate a node use `find_nodes`, which returns its path. (4) **Don't thrash** — plan the structure before building it, and edit a snippet through `update_snippet`'s `innerPatch` rather than redefining its body.",
  "",
  '**Think in ids, not paths.** Anywhere a tool asks for a `path` (or `parentPath`, `fromPath`, `toParent`), pass a stable id reference like `"@hero-cta"`. Assign ids at creation (`id: "hero-cta"`) for anything you might touch again. Number paths are positional and break when siblings move; treat them as an implementation detail you get from `find_nodes` (`set_node_id` retrofits one).',
  "",
  '**Verify before declaring done.** `screenshot mode: "compare"` renders light and dark side by side; `audit` scores the screen; `validate_classes` is free and fast on arbitrary-value classes. See velloo://guide/verification.',
  "",
  "**Make it distinctive.** Default library + Inter + one indigo reads as template. Set a display face and a typeset early via `set_theme` — one call re-proportions every screen — then reach for real art and confident color. See velloo://guide/art.",
  "",
  "**Read the guide before doing the thing.** These resources carry the detail this brief deliberately omits — fetch the relevant one at the start of that kind of work:",
  "  - `velloo://guide/components` — Box vs Card, children arrays vs the children prop, inline runs, icons, raw CSS.",
  "  - `velloo://guide/snippets` — params, node slots, `$if`, and when structure that varies is still one snippet.",
  "  - `velloo://guide/theme` — tokens, presets, fonts, the type ladder, importing an app's stylesheet.",
  "  - `velloo://guide/boards` — frames vs viewports, sidebar groups, archived boards, board-pinned themes.",
  "  - `velloo://guide/verification` — screenshot modes, diffing, audit, inspect.",
  "  - `velloo://guide/porting` — code-to-design: re-expressing an existing app and verifying fidelity.",
  "  - `velloo://guide/capture` — reaching pages behind a login.",
  "  - `velloo://guide/extensions` — registering the app's own components, live islands.",
  "  - `velloo://guide/art` — authoring assets vs paying to generate them.",
  "  - `velloo://guide/comments` — working the user's visual feedback threads.",
  "",
  "**Visual feedback threads are addressed to you.** Call `list_comment_threads` at the start of a session and work the open ones — read with `get_comment_thread`, make the change, then `update_comment_thread` to reply and resolve.",
];

/**
 * Appended only when this folder opted into feedback (so the agent never sees
 * the tool, or guidance for it, otherwise). Mirrors the consent rules baked
 * into the tool description.
 */
const FEEDBACK_INSTRUCTION =
  "**Sending product feedback**: this folder opted into the `send_feedback` tool. Reach for it when you hit friction with **Velloo itself** — a confusing instruction, a missing capability, a tool that misbehaved, a bug — or when the user asks to send feedback. ALWAYS show the user the exact `body` and get their go-ahead before calling; never send unprompted, even when you originated the idea. Fire sparingly — one report per distinct issue, never repeated. NEVER include the user's design content, code, or file/repo paths; describe the issue in your own words. This is feedback about Velloo, not about the design.";

/**
 * The instructions string. `canvasUrl` (when the MCP boots alongside a canvas)
 * is surfaced so the agent can hand the user a URL to watch — important under
 * the stdio transport, where the canvas binds an ephemeral port the user can't
 * predict. The feedback paragraph is appended only when opted in. `intro` is the
 * adapter-supplied framework framing (`FrameworkAdapter.mcpIntro`, resolved for
 * the folder's style channel; empty ⇒ the default shadcn framing). `openComments`
 * adds one waiting-feedback line when greater than zero.
 */
export function buildInstructions(
  feedbackEnabled: boolean,
  canvasUrl?: string,
  intro: readonly string[] = [],
  openComments = 0,
  hostTailwindMajor: 3 | 4 | null = null,
  bareFolder = false,
): string {
  const parts = [...intro, ...INSTRUCTION_PARTS];
  if (bareFolder) {
    parts.unshift(
      "**Bare folder.** This design has no boards yet. Setup order before composing UI: (1) style the theme with `set_theme` (or `import_theme` to match an existing app); (2) `add_board`; (3) add screens and frames, then design.",
      "",
    );
  }
  if (hostTailwindMajor === 3) {
    parts.push(
      "",
      "**The host app is on Tailwind v3** (the canvas itself always compiles v4). Prefer classes spelled the same in both majors; avoid v4-only utilities (`inset-shadow-*`, `text-shadow-*`, `bg-linear-*` angles, container-query variants, `starting:`) — `validate_classes` warns per class and `emit_code` returns a `tailwindV3Compat` rename list (e.g. v4 `shadow-sm` ⇒ v3 `shadow`) to apply when writing app code. `emit_theme` detects the v3 target and emits `velloo-theme.css` + a `velloo.preset` instead of a v4 globals.css.",
    );
  }
  if (canvasUrl) {
    parts.push(
      "",
      `**The live canvas** is running at ${canvasUrl} — give the user this URL up front so they can open it and watch your edits render in real time. (They can also open a canvas any time with \`velloo run\`.)`,
    );
  }
  if (openComments > 0) {
    parts.push(
      "",
      openComments === 1
        ? "**1 open visual feedback thread is waiting on you** — read it with `list_comment_threads` and address it."
        : `**${openComments} open visual feedback threads are waiting on you** — read them with \`list_comment_threads\` and address them.`,
    );
  }
  if (feedbackEnabled) parts.push("", FEEDBACK_INSTRUCTION);
  return parts.join("\n");
}

function buildMcpServer(
  ctx: MutationContext,
  jit: TailwindJit,
  bundler: LiveBundler,
  canvasBundler: CanvasBundler,
  comments: LocalCommentsService,
  assetOrigin?: string,
  cloud?: CloudAuth,
): McpServer {
  // Opt-in AND reachable: with no cloud configured the tool could never do
  // anything, so neither it nor its instruction paragraph is worth a session's
  // context.
  const feedbackEnabled = Boolean(ctx.folder.config.feedback?.enabled && cloud?.url);
  // Framework framing comes from the adapter itself (its style channel picks
  // the variant for multi-channel providers) — no provider ids here.
  const channel = styleChannelOf(ctx.defaultProvider, ctx.folder.config.styling?.framework);
  const channelKind = channel.kind;
  const intro = (ctx.defaultProvider as FrameworkAdapter).mcpIntro?.(channelKind) ?? [];
  // Tailwind-channel folders whose host app is still on v3 get the downlevel
  // guidance up front (the canvas always compiles v4).
  const hostTailwindMajor = channel.needsTailwindJit
    ? detectTailwindMajor(hostAppRootFrom(ctx.folder.root, ctx.folder.config.hostApp))
    : null;
  // Synchronous local state only: initializing an agent session never needs
  // a network call. Shared threads are folded into this service when synced.
  const openComments = comments.countOpenSync();
  const bareFolder = ctx.folder.boards.size === 0;
  const mcp = new McpServer(
    { name: "velloo", version: "0.1.0" },
    {
      instructions: buildInstructions(
        feedbackEnabled,
        assetOrigin?.replace(/\/+$/, ""),
        intro,
        openComments,
        hostTailwindMajor,
        bareFolder,
      ),
    },
  );
  // Before any tool registers: strict input shapes (a typo'd argument fails
  // loudly with the valid keys instead of being silently dropped) and the
  // behavioural annotations a host reads to decide what to auto-approve.
  applyToolPolicy(mcp);
  // Hidden, env-gated session tape (VELLOO_TRACE). Wrap after the policy patch
  // so every handler is taped; no-op when the flag is unset.
  const recorder = createTraceRecorder(ctx.folder.root);
  if (recorder) withCallRecording(mcp, recorder);
  registerDiscoveryTools(mcp, ctx);
  registerMutationTools(mcp, ctx);
  registerInspectTool(mcp, ctx);
  registerThemeTools(mcp, ctx);
  registerEmitTools(mcp, ctx);
  registerScreenshotTool(mcp, ctx, jit, bundler, canvasBundler, assetOrigin);
  registerValidateTools(mcp, ctx, jit);
  registerExtensionTools(mcp, ctx);
  registerCatalogTools(mcp, ctx);
  registerNoteTools(mcp, ctx);
  registerAssetTools(mcp, ctx);
  registerBatchTool(mcp, ctx);
  registerCaptureTools(mcp, ctx);
  // Opt-in, auth-gated. The credential may be absent (logged out) or go stale
  // mid-session, so the tool checks at call time and reports a kinded
  // `signed-out` error the agent can act on.
  if (feedbackEnabled && cloud) registerFeedbackTool(mcp, ctx, cloud);
  registerCommentTools(mcp, comments);
  // Hosted generation: quota/feature failures return actionable messages.
  registerGenerateTools(mcp, ctx, cloud ?? { url: "" });
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
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: (id) => {
              sessions.set(id, { transport, server });
            },
          });
          const server = buildMcpServer(
            ctx,
            opts.jit,
            opts.bundler,
            opts.canvasBundler,
            opts.comments,
            opts.assetOrigin,
            opts.cloud,
          );
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
          session = { transport, server };
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
        sendJson(res, 500, { error: String(err) });
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
    sessions: () => sessions.size,
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
  const server = buildMcpServer(
    ctx,
    opts.jit,
    opts.bundler,
    opts.canvasBundler,
    opts.comments,
    opts.assetOrigin,
    opts.cloud,
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return {
    async close() {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    },
  };
}
