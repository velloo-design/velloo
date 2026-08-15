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
import { registerExtensionTools } from "./tools/extensions.ts";
import { registerGenerateTools } from "./tools/generate.ts";
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
  'Before composing screens, call `list_components` (use mode: "summary" first — the full schema is large) and `get_theme` to understand the available palette and active tokens. Also `list_snippets` — reuse existing snippets before defining new ones. `list_boards` shows the boards in the folder; each board hosts frames pointing at screens. For an overview of an existing screen, use `get_screen mode: "outline"` (compact ref+id+classSnippet tree) before pulling the full JSON.',
  "",
  '**Prefer semantic theme tokens** (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `bg-accent`, etc.) over raw Tailwind palette colors (`bg-zinc-900`, `text-white`, `text-emerald-400`). Semantic tokens auto-flip under `screenshot mode: "dark"` and survive theme changes; raw palette colors render identically in both modes. Use raw palette only for *intentional* accent colors that should NOT theme-flip.',
  "",
  "`inspect_dark_diff` is a **triage signal, not a gate**. It flags every color-bearing class that won't theme-flip — including ones you chose intentionally (brand gradients, status pill chrome, accent overlays). Read the per-node `problems[]` and decide; the coverage number is a guide, not a target. Structural utilities (`border-b`, `ring-0`, `shadow-none`, `text-xl`, `bg-transparent`, `text-current`) are already exempt. To exclude a deliberately non-flipping node entirely, set `data-accent: \"ok\"` (or any string) on its props — the audit skips data-accent nodes and they don't count toward the score. Use for brand marks, hero gradients, dark-tuned pills with explicit `dark:` variants, etc.",
  "",
  "**`children` arrays are the default mental model.** `add_node` accepts a full subtree (every child can have its own props + children) — build a feature card or nav row in one call rather than walking the tree. The old one-node-per-call habit produces unnecessary round-trips.",
  "",
  'Anywhere a tool asks for a `path` (or `parentPath`, `fromPath`, `toParent`), you can pass a stable id reference like `"@hero-cta"` instead of a number array. Pass `id: "hero-cta"` to `add_node` / `instantiate_snippet` to assign one, or `set_node_id` to retroactively name an existing node. Ids survive sibling insertions and deletions — use them for anchors you\'ll reference more than once.',
  "",
  "**Three customization layers** stack additively in every folder ( A folder registers N (`config.libraries`); each screen pins one via `screen.library`. Multi-library lets marketing boards use no-lib while app boards use shadcn in the same folder. Component ids resolve against the screen's library only.",
  "  - **Extensions** add wholly new components the active library doesn't have — your app's custom `DataTable`, a brand `Hero`, a bespoke `PriceChart`. Register one with `add_extension` (it persists in `.design/config.json`); the canvas renders a placeholder card carrying the component id + props, and `emit_code` emits a real `import` from the extension's declared `importPath`. Extensions are folder-global and shadow library components with the same id. Use them for *additive customization*, NOT for compositions (snippets cover that).",
  "  - **Snippets** compose existing components (library + extension) into named subtrees with typed params. Use them for repeated structure (FeatureCard, NavRow, PricingTier).",
  "",
  '`list_components` returns both library entries and extensions in one call, each tagged with `kind: "library" | "extension"`. Filter with `kind` when you only want one type.',
  "",
  "Prefer snippets for repeated structure (feature cards, list items, hero sections). Create the snippet once with `add_snippet`, then call `instantiate_snippet` per occurrence. **Snippet instances are opaque** — you can't address paths inside them; design for variation up-front:",
  "",
  '  - `{"$if": "paramName", "then": <value>, "else": <value>}` — picks a branch by truthiness of `args.paramName`. **Boolean params only** (true/false). Non-boolean truthy values "work" via JS coercion but you\'ll trip on edge cases (empty string is falsy, the string `"false"` is truthy). Declare params as `type: "boolean"`.',
  "  - String params (`tone`, `variant`) for full-className swaps when the variation is more than two-way.",
  '  - `type: "node"` params for slot composition — the caller passes a full subtree (e.g. an accent overlay or icon block). This is cleaner than threading complex layout decisions through a string param.',
  "  - `extraClassName` on `instantiate_snippet` / `update_snippet_args` — a one-off Tailwind suffix appended to the body root. Cascades through nested snippet roots (snippet-of-a-snippet still gets the override).",
  "",
  "**Always call `render_snippet` after `add_snippet`** to verify a new definition rendered as intended — `$param` wiring bugs (placeholder didn't expand, gradient missing, `$if` truthy-coerced wrong) are silent at definition time and only show up at instantiation. Preview before stamping. Snippets emit as real React components on `emit_code` with a typed `className?: string` prop.",
  "",
  "Screens have one tree; viewport size is a property of each `frame` placement on a board, not of the screen. Different viewport renderings of the same screen → multiple frames pointing at the same screen (edits sync across all of them). Different layouts per breakpoint → separate screens with their own frames. `screenshot` defaults to `fullPage: true` but the rendered HTML is bounded by the requested `viewport.h` — pass a taller viewport for long marketing screens, or extract sections into snippets.",
  "",
  "Text content for `Heading`, `Text`, `Button`, `Badge`, `Label` goes in the `children` prop, not a `text` prop. `Heading.level` controls only the HTML tag + a baked size ladder (h1 = text-5xl bold, h6 = text-lg semibold); override with `className` if you want a different size. `Icon` takes any lucide-react name as its `name` prop (e.g. Sparkles, ArrowRight, Check). For placeholder imagery (avatars, hero shots) use the `Placeholder` component instead of faking with gradient divs.",
  "",
  '**Verification loop**: when a screen feels done, run `screenshot mode: "compare"` — returns one PNG with light + dark rendered side-by-side, the fastest signal that the design actually adapts. Call `inspect_dark_diff` to score the screen; coverage 1.0 + an empty problems list is the green light. `validate_classes` is free and fast — run it on any arbitrary-value classes (`shadow-[…]`, `grid-cols-[…]`, etc.) before relying on them. `inspect` returns SSR\'d HTML + resolved props for a specific node when you need to verify what landed.',
  "",
  '**Designer annotations**: `list_annotations(screenId)` returns markdown notes the designer attached to specific nodes on a screen. Treat them as guidance for the current screen — addressable feedback like "this CTA should land harder" or "tighten the copy." Each annotation carries a `resolved` path (null when the targeted node has been removed — low-priority, the designer\'s note is stale). Read-only: you can act on annotations but not create or edit them.',
].join("\n");

function buildMcpServer(ctx: MutationContext, jit: TailwindJit): McpServer {
  const mcp = new McpServer({ name: "velloo", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  registerDiscoveryTools(mcp, ctx);
  registerMutationTools(mcp, ctx);
  registerInspectTool(mcp, ctx);
  registerThemeTools(mcp, ctx);
  registerEmitTools(mcp, ctx);
  registerScreenshotTool(mcp, ctx, jit);
  registerValidateTools(mcp, ctx);
  registerGenerateTools(mcp, ctx);
  registerExtensionTools(mcp, ctx);
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
