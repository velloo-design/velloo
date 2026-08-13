import { randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { MutationContext } from "../mutations/index.ts";
import type { TailwindJit } from "../styles/tailwind-jit.ts";
import { registerDiscoveryTools } from "./tools/discovery.ts";
import { registerEmitTools } from "./tools/emit.ts";
import { registerInspectTool } from "./tools/inspect.ts";
import { registerMutationTools } from "./tools/mutations.ts";
import { registerScreenshotTool } from "./tools/screenshot.ts";
import { registerThemeTools } from "./tools/theme.ts";
import { registerValidateTools } from "./tools/validate.ts";

export interface McpServerOptions {
  port: number;
  host: string;
  jit: TailwindJit;
}

export interface McpServerHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

const INSTRUCTIONS = [
  "You are working on a Velloo design folder. Components come from a pinned shadcn snapshot. Designs are static — click handlers, routing, and forms are no-op.",
  "",
  'Before composing pages, call `list_components` (use mode: "summary" first — the full schema is large) and `get_theme` to understand the available palette and active tokens. Also `list_snippets` — reuse existing snippets before defining new ones.',
  "",
  '**Prefer semantic theme tokens** (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `bg-accent`, etc.) over raw Tailwind palette colors (`bg-zinc-900`, `text-white`, `text-emerald-400`). Semantic tokens auto-flip under `screenshot mode: "dark"` and survive theme changes; raw palette colors render identically in both modes. Use raw palette only for *intentional* accent colors that should NOT theme-flip. Run `inspect_dark_diff` to verify your page is actually dark-mode-aware.',
  "",
  "Use add_node's `children` parameter to add whole subtrees in one call — every child can itself be a full node (with props + children). One call beats N round-trips.",
  "",
  'Anywhere a tool asks for a `path` (or `parentPath`, `fromPath`, `toParent`), you can pass a stable id reference like `"@hero-cta"` instead of a number array. Pass `id: "hero-cta"` to `add_node` / `instantiate_snippet` to assign one, or `set_node_id` to retroactively name an existing node. Ids survive sibling insertions and deletions — use them for anchors you\'ll reference more than once. Per-variant uniqueness is enforced; the same id can repeat across variants of the same page (intentional, e.g. "@hero-cta" on mobile + desktop is the same anchor).',
  "",
  'Prefer snippets for repeated structure (feature cards, list items, hero sections). Create the snippet once with `add_snippet`, then call `instantiate_snippet` per occurrence. Snippets emit as real React components on `emit_code`. For per-instance style variation, declare a boolean param and use `{"$if": "paramName", "then": "...", "else": "..."}` anywhere a value appears — string `$param` substitution cannot interpolate *inside* a class name, only replace whole values.',
  "",
  "New pages get one variant at the requested viewport. Use `add_variant` (or `add_variant` with `fromVariantId` to clone) for additional viewports. Tall marketing pages need a tall viewport: `screenshot` defaults to `fullPage: true` but the rendered HTML is still bounded by the variant's `viewport.h` — extend it or split the page into variants.",
  "",
  "Text content for Heading, Text, Button, Badge, Label goes in the `children` prop, not a `text` prop. Icon takes any lucide-react name as its `name` prop (e.g. Sparkles, ArrowRight, Check). For placeholder imagery (avatars, hero shots) use the `Placeholder` component instead of faking with gradient divs.",
  "",
  "`screenshot` is available — call it to verify layout when something feels off rather than guessing. `validate_classes` is free and fast — run it on any arbitrary-value classes (`shadow-[…]`, `grid-cols-[…]`, etc.) before relying on them.",
].join("\n");

function buildMcpServer(ctx: MutationContext, jit: TailwindJit): McpServer {
  const mcp = new McpServer({ name: "velloo", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  registerDiscoveryTools(mcp, ctx);
  registerMutationTools(mcp, ctx);
  registerInspectTool(mcp, ctx);
  registerThemeTools(mcp, ctx);
  registerEmitTools(mcp, ctx);
  registerScreenshotTool(mcp, ctx, jit);
  registerValidateTools(mcp);
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
    (m) => m && typeof m === "object" && (m as { method?: string }).method === "initialize",
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
          const server = buildMcpServer(ctx, opts.jit);
          transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
            void server.close().catch(() => undefined);
          };
          await server.connect(transport);
          session = { transport, server };
        }

        await session.transport.handleRequest(req, res, body);
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
