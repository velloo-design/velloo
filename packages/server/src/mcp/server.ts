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
import { detectTailwindMajor } from "@velloo/codegen";
import { type FrameworkAdapter, styleChannelOf } from "@velloo/provider";
import { withActor } from "../activity.ts";
import type { CloudAuth } from "../cloud.ts";
import { designSystemDoc } from "../design-system.ts";
import { hostAppRootFrom } from "../live/bundle-core.ts";
import type { CanvasBundler } from "../live/canvas-bundler.ts";
import type { LiveBundler } from "../live/component-bundler.ts";
import type { LocalCommentsService } from "../local-comments.ts";
import type { MutationContext } from "../mutations/index.ts";
import { requestIsLocal } from "../security.ts";
import type { TailwindJit } from "../styles/tailwind-jit.ts";
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
import { registerDesignTools } from "./tools/designs.ts";
import { registerDiscoveryTools } from "./tools/discovery.ts";
import { registerEmitTools } from "./tools/emit.ts";
import { registerExtensionTools } from "./tools/extensions.ts";
import { registerFeedbackTool } from "./tools/feedback.ts";
import { registerGenerateTools } from "./tools/generate.ts";
import { registerHostFileTools } from "./tools/host-files.ts";
import { registerInspectTool } from "./tools/inspect.ts";
import { registerMutationTools } from "./tools/mutations.ts";
import { registerNoteTools } from "./tools/notes.ts";
import { registerRepoTools } from "./tools/repo.ts";
import { registerScreenshotTool } from "./tools/screenshot.ts";
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
  /** Count of live MCP sessions — feeds the daemon's idle-shutdown check. */
  sessions(): number;
  close(): Promise<void>;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

/**
 * What every init handoff prompt used to spell out, stated once here: agents
 * waited for Velloo to start the app, and designed from memory when it wasn't
 * running.
 */
const MATCHING_AN_APP =
  "**Matching an existing app:** start it yourself — Velloo never runs it. Before composing, `import_theme` its stylesheet and set its real fonts with `set_theme` (read how the app loads them) — the wrong typeface makes everything else look wrong. Then iterate with `compare_to_url` against the real page, fixing its `topMismatches` in order. If the app can't run here, say what's missing rather than designing from memory.";

/**
 * The always-resident boot guidance.
 *
 * Scoped deliberately: this carries only what no single tool description can —
 * the mental model and the efficiency contract that governs how MANY calls a
 * session makes. Everything task-specific lives in
 * a `velloo://guide/*` resource (see resources.ts) and is fetched on demand, so
 * a session that never ports an app never pays for the porting manual. Adding a
 * paragraph here taxes every session forever — check whether it belongs in a
 * guide or a tool description first.
 */
const INSTRUCTION_PARTS = [
  "You are working on a Velloo design folder: a code-shaped design canvas built from the project's real component library. Designs are static — click handlers, routing and forms are no-ops.",
  "",
  "**Never edit the design folder's files by hand.** Every change goes through these tools, which hold the lock, validation and history. The user watches edits live with `velloo run`.",
  "",
  '**Read once, then build in big strokes** — a screen takes a few dozen calls, not hundreds. Start with `list_components`, `get_theme` and `list_boards` (`get_screen mode: "outline"` for an existing screen). Build whole subtrees in one `compose` call (nested JSX) and group property edits in one `batch`; don\'t re-read unchanged state (`find_nodes` relocates a node). Give nodes you will touch again an id (`id: "hero-cta"`) and address them as `"@hero-cta"`, never by numeric path.',
  "",
  "**Use the library's own components.** Before building a pattern from `Box` + `Text`, check the catalog: a labelled input is `Field`, a search box `InputGroup`, a settings row `Item`, an empty state `Empty`, joined buttons `ButtonGroup`; a family listing `pieces` is composed of them. Structure you repeat goes in a snippet (`add_snippet`); a component the library lacks is an extension (`add_extension`).",
  "",
  "**Styling is framework-native.** `update_props { style }` takes the screen framework's own form — Tailwind classes, `sx`, or a `style` object. Prefer semantic theme tokens (`bg-background`, `text-muted-foreground`): only they flip in dark mode. Set a display face and typeset early with `set_theme` so the result doesn't read as a template.",
  "",
  MATCHING_AN_APP,
  "",
  "**Verify before declaring done.** Mutations return render diagnostics (`render/component-threw` means a placeholder renders there — its message names what the component needs); look at a `screenshot`; `emit_code` hands the design to implementation.",
  "",
  "The advertised `velloo://guide/*` resources hold the detail — read the relevant one before an unfamiliar capability.",
];

const GUIDED_INSTRUCTION_PARTS = [
  "You are working on a Velloo design folder: a code-shaped design canvas built from the project's real component library.",
  "",
  "**Never edit the design folder's files by hand.** Every change is an operation: `call_velloo` runs one, `run_velloo_plan` up to eight. Call them directly — a failed call returns the operation's exact schema, so `operation_schema` is only for one you have never used.",
  "",
  "Build in big strokes — whole subtrees with `compose`, property edits in one `batch` — keep stable node ids, prefer theme tokens, and don't re-read unchanged state. Look at a `screenshot` before calling a design done; `emit_code` hands it to implementation.",
  "",
  MATCHING_AN_APP,
  "",
  "The advertised `velloo://guide/*` resources hold the detail (`porting`, `theme`, `verification`, `art`, `comments`, …) — read the relevant one before an unfamiliar capability.",
];

/**
 * Appended only when this folder opted into feedback (so the agent never sees
 * the tool, or guidance for it, otherwise). Mirrors the consent rules baked
 * into the tool description.
 */
const FEEDBACK_INSTRUCTION =
  "**Sending product feedback**: this folder opted into `send_feedback`, for friction with **Velloo itself** (a confusing instruction, a missing capability, a bug) or when the user asks. ALWAYS show the user the exact `body` and get their go-ahead before calling — never unprompted, one report per issue. NEVER include the user's design content, code, or file paths.";

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
  surface: McpSurfaceSelection = { mode: "full" },
  designs: SessionDesigns | null = null,
  designSystemPath: string | null = null,
): string {
  const parts = [
    ...intro,
    ...(surface.mode === "guided" ? GUIDED_INSTRUCTION_PARTS : INSTRUCTION_PARTS),
  ];
  if (bareFolder) {
    parts.unshift(
      "**Bare folder.** This design has no boards yet. Setup order before composing UI: (1) style the theme with `set_theme` (or `import_theme` to match an existing app); (2) `add_board`; (3) add screens and frames, then design.",
      "",
    );
  }
  // Which design, of several, comes before anything about how to work on it.
  if (designs) parts.unshift(...designsInstruction(designs), "");
  if (hostTailwindMajor === 3) {
    parts.push(
      "",
      "**The host app is on Tailwind v3** (the canvas compiles v4). Prefer classes spelled the same in both; avoid v4-only utilities (`inset-shadow-*`, `text-shadow-*`, `bg-linear-*` angles, container queries, `starting:`) — mutations flag them. When writing app code, apply `emit_code`'s `tailwindV3Compat` renames; `emit_theme` emits a v3 preset.",
    );
  }
  if (designSystemPath) {
    parts.push(
      "",
      `**This folder follows a design system document: \`${designSystemPath}\`.** Read it before composing or reviewing — its brand intent and Do's and Don'ts outrank the generic defaults here. It is the repo's own file (\`get_theme\` returns its current path if it moves).`,
    );
  }
  if (canvasUrl) {
    parts.push(
      "",
      `**The live canvas** is running at ${canvasUrl} — give the user this URL up front so they can watch your edits render.`,
    );
  }
  if (openComments > 0) {
    // Named as operations rather than tools: on the guided surface they are
    // reachable only through the façade, and this line used to spell them as
    // bare tool names the agent could not find in its tool list.
    const one = openComments === 1;
    parts.push(
      "",
      `**${one ? "1 open visual feedback thread is" : `${openComments} open visual feedback threads are`} waiting on you.** ${
        one ? "It is a change" : "Each one is a change"
      } the user is expecting. Read ${one ? "it" : "them"} with the \`list_comment_threads\` operation, make the requested ${
        one ? "change" : "changes"
      }, then reply and resolve with \`update_comment_thread\`. The full loop is velloo://guide/comments.`,
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
  surface: McpSurfaceSelection = DEFAULT_MCP_SURFACE,
  designs: SessionDesigns | null = null,
): McpServer {
  // Opt-in AND reachable: with no cloud configured the tool could never do
  // anything, so neither it nor its instruction paragraph is worth a session's
  // context.
  const feedbackEnabled = Boolean(ctx.folder.config.feedback?.enabled && cloud?.url);
  // Framework framing comes from the adapter itself (its style channel picks
  // the variant for multi-channel providers) — no provider ids here.
  const channel = styleChannelOf(ctx.defaultProvider, ctx.folder.config.styling?.framework);
  const channelKind = channel.kind;
  const intro = [
    ...((ctx.defaultProvider as FrameworkAdapter).mcpIntro?.(channelKind) ?? []),
    ...repoInstruction(ctx),
  ];
  // Tailwind-channel folders whose host app is still on v3 get the downlevel
  // guidance up front (the canvas always compiles v4).
  const hostTailwindMajor = channel.needsTailwindJit
    ? detectTailwindMajor(hostAppRootFrom(ctx.folder.root, ctx.folder.config.hostApp))
    : null;
  // Synchronous local state only: initializing an agent session never needs
  // a network call. Shared threads are folded into this service when synced.
  const openComments = comments.countOpenSync();
  const bareFolder = ctx.folder.boards.size === 0;
  const mcp = new McpServer(MCP_SERVER_INFO, {
    instructions: buildInstructions(
      feedbackEnabled,
      assetOrigin && trimTrailingSlashes(assetOrigin),
      intro,
      openComments,
      hostTailwindMajor,
      bareFolder,
      surface,
      designs,
      designSystemDoc(ctx.folder)?.path ?? null,
    ),
  });
  // Installed before policy and tracing: native registrations flow through all
  // wrappers, then the selected surface disables or replaces their public view.
  const toolSurface = applyMcpToolSurface(mcp, surface);
  // Before any tool registers: strict input shapes (a typo'd argument fails
  // loudly with the valid keys instead of being silently dropped) and the
  // behavioural annotations a host reads to decide what to auto-approve.
  applyToolPolicy(mcp);
  // Hidden, env-gated session tape (VELLOO_TRACE). Wrap after the policy patch
  // so every handler is taped; no-op when the flag is unset.
  const recorder = createTraceRecorder(ctx.folder.root);
  if (recorder) withCallRecording(mcp, recorder);
  registerDiscoveryTools(mcp, ctx);
  registerComposeTool(mcp, ctx, jit);
  registerMutationTools(mcp, ctx, jit);
  registerInspectTool(mcp, ctx, jit, bundler, canvasBundler, assetOrigin);
  registerThemeTools(mcp, ctx);
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
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: (id) => {
              sessions.set(id, { transport, server });
            },
          });
          const parsedSurface = parseMcpSurfaceUrl(req.url);
          if (!parsedSurface.ok) {
            sendJson(res, 400, { error: parsedSurface.error });
            return;
          }
          const server = buildMcpServer(
            ctx,
            opts.jit,
            opts.bundler,
            opts.canvasBundler,
            opts.comments,
            opts.assetOrigin,
            opts.cloud,
            parsedSurface.selection,
            await sessionDesigns(
              ctx.folder.root,
              ctx.folder.config.name,
              parseMcpSessionUrl(req.url),
            ),
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
  const server = buildMcpServer(
    ctx,
    opts.jit,
    opts.bundler,
    opts.canvasBundler,
    opts.comments,
    opts.assetOrigin,
    opts.cloud,
    opts.surface ?? DEFAULT_MCP_SURFACE,
    // In-process stdio has no proxy to carry the session to another daemon.
    await sessionDesigns(ctx.folder.root, ctx.folder.config.name, {
      switchable: false,
      pick: undefined,
    }),
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

/**
 * The app's own components, stated up front when the design is bound to an
 * app: they are the first thing to reach for, and they need one setup step.
 * Synchronous on purpose (session start never waits on discovery), so it
 * speaks about the capability and the recipes found, not the catalog itself.
 */
function repoInstruction(ctx: MutationContext): string[] {
  const repo = ctx.repo;
  if (!repo) return [];
  const hostRoot = repo.host(undefined).hostRoot;
  if (!existsSync(join(hostRoot, "package.json"))) return [];
  const recipes = repo.recipes(undefined);
  return [
    "**Build with the app's own components first.** `list_components` shelves them under Repo, from what the app's routes render: its tables, panels, chips and forms beat rebuilding the same thing from library parts or primitives, so reach for them before anything else (a name that clashes with a Velloo primitive is qualified, `<Mantine.Button>`). Compose the page from them — the one thing not to place is the app's entire page or `App` as a single node, which renders but can't be edited. Style them through their declared props and fill a `slot` prop with an element (`leftSection={<IconBolt />}`). They render inside the folder's preview entry: run `preview_status` once before designing, and `set_preview_entry` if it needs a provider or stylesheet.",
    ...recipes.flatMap((recipe) => recipe.notes),
    "",
  ];
}
