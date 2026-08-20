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
import type { CloudAuth } from "../cloud.ts";
import type { LiveBundler } from "../live/component-bundler.ts";
import type { MutationContext } from "../mutations/index.ts";
import type { TailwindJit } from "../styles/tailwind-jit.ts";
import {
  applyDefaultTiers,
  flatToolsMode,
  instrumentTools,
  registerRevealTool,
  revealInstructions,
} from "./tiers.ts";
import { registerAssetTools } from "./tools/assets.ts";
import { registerBatchTool } from "./tools/batch.ts";
import { registerDiscoveryTools } from "./tools/discovery.ts";
import { registerEmitTools } from "./tools/emit.ts";
import { registerExtensionTools } from "./tools/extensions.ts";
import { registerFeedbackTool } from "./tools/feedback.ts";
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
  /** Canvas-server origin, used as <base href> in screenshot renders so /assets/* resolve. */
  assetOrigin?: string;
  /**
   * velloo-cloud credentials, resolved by the CLI and threaded in. Enables
   * the opt-in `send_feedback` tool. Absent ⇒ no cloud calls.
   */
  cloud?: CloudAuth;
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

const INSTRUCTION_PARTS = [
  'You are working on a Velloo design folder. Components come from a pinned shadcn snapshot plus velloo helpers (`Box` for layout, `Heading`/`Text`, `Image`, `Gradient`, `Layer`, `SVG`, `Divider`, `Placeholder`). Designs are static — click handlers, routing, and forms are no-op. Use `Box` (a plain div) for every flex/grid wrapper — and `Box as="span"` / `"strong"` / `"a"` to render an *inline* element (inline tags get their natural inline display, so inline runs do not stack vertically); reserve `Card` for actual card surfaces (it ships card chrome; only *image* cards clip to the rounded corners, so a bare Card lets an outside-the-box child — a `-top-3` "Most popular" badge — overflow instead of getting cut off).',
  "",
  'Before composing screens, call `list_components` (use mode: "summary" first — the full schema is large; full mode includes an `example` of working props per component — copy it, then adapt) and `get_theme` to understand the available palette and active tokens. Also `list_snippets` — reuse existing snippets before defining new ones. `list_boards` shows the boards in the folder; each board hosts frames pointing at screens. For an overview of an existing screen, use `get_screen mode: "outline"` (compact ref+id+classSnippet tree) before pulling the full JSON.',
  "",
  '**Prefer semantic theme tokens** (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `bg-accent`, etc.) over raw Tailwind palette colors (`bg-zinc-900`, `text-white`, `text-emerald-400`). Semantic tokens auto-flip under `screenshot mode: "dark"` and survive theme changes; raw palette colors render identically in both modes. Use raw palette only for *intentional* accent colors that should NOT theme-flip.',
  "",
  '**An object `style` prop is supported** for CSS that no utility expresses cleanly — a `radial-gradient` dot-grid, a custom `backgroundSize`, a one-off `clipPath`: `{"$ref":"Box","props":{"style":{"backgroundImage":"radial-gradient(circle at 1px 1px, color-mix(in srgb, currentColor 12%, transparent) 1px, transparent 0)","backgroundSize":"14px 14px"}}}`. It renders inline and `emit_code` writes it as a `style={{…}}` JSX prop. Reach for utility/arbitrary classes first where they exist (they keep theme-awareness and read as idiomatic shadcn) — classes passed through snippet *string params* compile fine (the JIT scans instance args, and `render_snippet` previews them too); reserve `style` for literal CSS no utility expresses.',
  "",
  "`audit` is a **triage signal, not a gate**. It flags every color-bearing class that won't theme-flip — including ones you chose intentionally (brand gradients, status pill chrome, accent overlays). Read the per-node `problems[]` and decide; the coverage number is a guide, not a target. Structural utilities (`border-b`, `ring-0`, `shadow-none`, `text-xl`, `bg-transparent`, `text-current`) are already exempt. To exclude a deliberately non-flipping node entirely, set `data-accent: \"ok\"` (or any string) on its props — the audit skips data-accent nodes and they don't count toward the score. Use for brand marks, hero gradients, dark-tuned pills with explicit `dark:` variants, etc. Pass `snippetId` instead of `screenId` to audit a snippet body at definition time.",
  "",
  "**`children` arrays are the default mental model.** `add_node` accepts a full subtree (every child can have its own props + children) — build a feature card or nav row in one call rather than walking the tree. For multi-screen builds, `batch` runs a sequence of mutations in one round-trip — atomic by default: on the first error every touched resource rolls back and the result reports `rolledBack: true` with the failing call (pass `atomic: false` for run-until-error without rollback). To find existing nodes, `find_nodes` queries a screen by $ref / $id / className substring / prop value and returns paths — use it instead of fetching and walking trees.",
  "",
  '**Think in ids, not paths.** Anywhere a tool asks for a `path` (or `parentPath`, `fromPath`, `toParent`), pass a stable id reference like `"@hero-cta"`. Assign ids at creation (`id: "hero-cta"` on `add_node` / `instantiate_snippet`) for every node you might touch again — sections, CTAs, anything findable. Number paths are positional and break when siblings move; treat them as an implementation detail you get from `find_nodes` when no id exists yet (`set_node_id` retrofits one).',
  "",
  "**Three customization layers** stack additively in every folder ( A folder registers N (`config.libraries`); each screen pins one via `screen.library`. Multi-library lets marketing boards use no-lib while app boards use shadcn in the same folder. Component ids resolve against the screen's library only.",
  "  - **Extensions** add wholly new components the active library doesn't have — your app's custom `DataTable`, a brand `Hero`, a bespoke `PriceChart`. Register one with `add_extension` (it persists in `.design/config.json`); the canvas renders a placeholder card carrying the component id + props, and `emit_code` emits a real `import` from the extension's declared `importPath`. Extensions are folder-global and shadow library components with the same id. Use them for *additive customization*, NOT for compositions (snippets cover that). For a component whose look needs the real implementation (charts especially), register it with `render:\"live\"` — Velloo bundles the actual component from your app (e.g. your exact recharts) and mounts it in the canvas for a pixel-faithful preview (now also in `screenshot` / `compare_to_url` / `render_snippet`, not just the live canvas), falling back to the placeholder on any failure. The built-in `Chart` node previews via echarts without an extension — handy for a generic chart, but it will NOT pixel-match an app built on recharts/visx/chart.js, so when you're porting a charts-heavy app reach for a `render:\"live\"` extension of the app's own chart component for fidelity.",
  '  - **Snippets** compose existing components (library + extension) into named subtrees with typed params. Use them for repeated structure (FeatureCard, NavRow, PricingTier). Reference a snippet with a `{"$snippet":"<kebab-id>"}` node or `instantiate_snippet` — NOT `$ref`, which is only for PascalCase library components / registered extensions. A PascalCase name that is actually a snippet (`$ref:"SiteHeader"` for the snippet `site-header`) is a common mix-up.',
  "",
  '`list_components` returns both library entries and extensions in one call, each tagged with `kind: "library" | "extension"`. Filter with `kind` when you only want one type.',
  "",
  "Prefer snippets for repeated structure (feature cards, list items, hero sections). Create the snippet once with `add_snippet`, then call `instantiate_snippet` per occurrence. **Design snippets for variation up-front** — params are the contract. For a true one-off ('this instance, but with a red badge'), `override_snippet_props` patches a node inside one instance's body without forking the snippet; emit_code inlines such instances. Variation axes:",
  "",
  '  - `{"$if": "paramName", "then": <value>, "else": <value>}` — picks a branch by truthiness of `args.paramName`. **Boolean params only** (true/false). Non-boolean truthy values "work" via JS coercion but you\'ll trip on edge cases (empty string is falsy, the string `"false"` is truthy). Declare params as `type: "boolean"`.',
  "  - String params (`tone`, `variant`) for full-className swaps when the variation is more than two-way.",
  '  - `type: "node"` params for slot composition — the caller passes a full subtree (e.g. an accent overlay or icon block) — one node, or an array of nodes that render as siblings in the slot (so `actions: [btnA, btnB]` is fine). Mark a slot `optional: true` for a may-or-may-not-be-there slot (a header `action`, a card `badge`): omit it at instantiation and it renders/emits nothing — no throwaway placeholder node needed. This is cleaner than threading complex layout decisions through a string param. **For an icon that varies per instance** (driven by status, priority, etc.), use a `node` param, NOT an `icon` param: an `icon` param resolves to one fixed lucide component, so `emit_code` bakes that single icon into the JSX (a lucide name has to be a literal JSX tag) and every instance renders the same glyph — a `node` param emits as a `{slot}` the caller fills per instance. Reserve `icon` params for a single icon chosen once at design time.',
  "  - `extraClassName` on `instantiate_snippet` / `update_snippet_args` — a one-off Tailwind suffix appended to the body root. Cascades through nested snippet roots (snippet-of-a-snippet still gets the override).",
  "",
  "**Always call `render_snippet` after `add_snippet`** to verify a new definition rendered as intended — `$param` wiring bugs (placeholder didn't expand, gradient missing, `$if` truthy-coerced wrong) are silent at definition time and only show up at instantiation. Preview before stamping. Snippets emit as real React components on `emit_code` with a typed `className?: string` prop.",
  "",
  "**Recipes — reach for the right tool** (with ~80 tools this saves round-trips):",
  '  - Tweak one node in *one* snippet instance ("this card\'s badge is red") → `override_snippet_props` { path: instance, innerPath: "@id", propPatch }.',
  "  - Tweak one node across *all* instances of a snippet → `update_snippet` { patch: { innerPatch: { innerPath, propPatch } } } — no need to resend the body. Replace the whole body → `update_snippet` { patch: { tree } }. Change an instance's inputs (not the body) → `update_snippet_args`.",
  '  - A `type:"node"` param takes a single node OR an array of nodes (they render as siblings in the slot) — `actions: [btnA, btnB]` is fine.',
  '  - The `children` *array* (`node.children`) is for nodes; a bare string/number there auto-wraps into an inline `Box as="span"` (so `children:["Most popular"]` just works). For **inline rich text** — a styled span mid-sentence, like a gradient word in a headline or a bold/linked run in a paragraph — put an array in the `children` *prop* mixing strings and nodes: `{"$ref":"Heading","props":{"children":["You get ",{"$ref":"Text","props":{"className":"text-primary","children":"the math right"}}]}}`. Text runs keep their exact spacing; inline nodes flow inline (they select as part of the parent, not separately). A plain string `children` is still the common case for non-styled text.',
  "  - Resize a `Heading`/`Text` → pass a className that *includes* an explicit `text-*` size (the level/variant size only loses to a competing `text-*` class). Find a node's path you don't know → `find_nodes`; don't guess numeric paths.",
  '  - Check dark fidelity against a running app → `compare_to_url` mode:"dark" (drives the target page dark too).',
  "  - Compare against an auth-gated page → pass `storageStatePath` (a Playwright storage-state JSON with the logged-in session) to `compare_to_url`. If the result is `unverified` (it redirected to login / hit an auth wall) the similarity is meaningless — authenticate or leave the screen unverified; never tune a design to a page you never actually saw.",
  "",
  "Screens have one tree; viewport size is a property of each `frame` placement on a board, not of the screen. Different viewport renderings of the same screen → multiple frames pointing at the same screen (edits sync across all of them). Different layouts per breakpoint → separate screens with their own frames. **A frame's `w`/`h` is canvas layout only** — `screenshot` / `compare_to_url` ignore it and render at their *own* viewport (the explicit `w`/`h`/`viewport` arg, defaulting to the folder's Desktop preset). `screenshot` defaults to `fullPage: true`, so it captures the screen's **full natural height** regardless of `viewport.h` (the viewport sets width + the initial fold, not a ceiling — that's why a screenshot can look complete while the board frame clips below the fold). A frame on the board, by contrast, is a fixed `w×h` window: content past its `h` is unreachable in the board view. So the screenshot's `contentHeight` / `compare_to_url`'s `contentHeight` and the `framesShorterThanContent` list are your signal that a placement needs a taller frame (`update_frame`) or the screen needs splitting.",
  "",
  '**Make it distinctive.** Default shadcn + Inter + one indigo reads as template. The personality levers: (1) `set_fonts` — declare a display face (role: "display" → class `font-display`) before composing; Google Fonts load in design mode and emit into globals.css. (2) `custom_css` — keyframes, grain/noise textures, clip-paths, ::selection. (3) `upload_asset` — author your own SVG/raster art (hero shapes, textures, marks) and reference it as `<Image src="/assets/…">`. (4) Theme tokens are yours: `derive_palette_from_color` / `set_token` an opinionated palette instead of living with the default. Big type, real art, confident color — then verify with screenshots.',
  "",
  'Text content for `Heading`, `Text`, `Button`, `Badge`, `Label` goes in the `children` prop, not a `text` prop. `Heading.level` controls only the HTML tag + a baked size ladder (h1 = text-5xl bold, h6 = text-lg semibold); override with `className` if you want a different size — but the className must include an explicit `text-*` size to win (a className with only spacing/weight like `mb-1 font-semibold` leaves the ladder size in place; add `text-base` to actually shrink it). `Icon` takes a lucide-react name as its `name` prop — PascalCase ("ArrowRight") or kebab-case ("arrow-right") both resolve; a name that matches no lucide icon renders the fallback "?" glyph and the mutation result carries an advisory warning. For placeholder imagery (avatars, hero shots) use the `Placeholder` component instead of faking with gradient divs.',
  "",
  '**Verification loop**: when a screen feels done, run `screenshot mode: "compare"` — returns one PNG with light + dark rendered side-by-side, the fastest signal that the design actually adapts. While iterating, `screenshot diff: true` compares against your previous capture: zero change costs no image at all, small changes return a highlight crop naming the changed nodes. Pass `scale: 0.5` when checking layout (smaller payload), and `path` to capture a single node close-up. Call `audit` to score the screen; coverage 1.0 + an empty problems list is the green light. `validate_classes` is free and fast — run it on any arbitrary-value classes (`shadow-[…]`, `grid-cols-[…]`, etc.) before relying on them. `inspect` returns SSR\'d HTML + resolved props for a specific node when you need to verify what landed.',
  "",
  "**Code-to-design (porting an existing app)**: when asked to bring an existing app's pages onto the canvas, *re-express — don't clone*. The loop: (1) `import_theme` with the app's globals.css (`cssPath` — an absolute path or one relative to the host app root, since globals.css lives OUTSIDE the design folder; or paste the stylesheet as `css`; dry-run first, then `apply: true`) so palette/radius/fonts match before any composition — beyond the semantic slots, it captures every other custom color var into the theme `palette`: numeric scales (`--primary-600`), extra roles (`--success-500`, `--danger`), AND bare brand names (`--paprika`, `--ink`, `--teal`). The `palette.*` namespace is a raw passthrough — `palette.ink` makes `bg-ink`/`text-ink`/`border-ink` resolve literally on the canvas — distinct from the semantic `colors.*` slots that theme-flip in dark mode. So app classes like `bg-primary-600` / `text-success-500` / `bg-ink` render as-is instead of falling back. Add or tweak entries by hand with `set_token palette.<name>` (e.g. `set_token palette.ink \"#1a1a1a\"`); run `validate_classes` if unsure a class resolved. It also reports the app's Tailwind `container` config as `container.suggestedClasses` (centered/padded/capped layout doesn't transfer as a theme — wrap page content in a `Box` with those classes, or use `Container`). (2) Read the page's source in the host repo alongside `list_components`. The route-scan already created one placeholder screen per detected route (id = route slug) — build INTO the existing screen (clear the placeholder with `remove_node`, then `add_node` / `instantiate_snippet`); don't `add_screen` for a scanned route, it returns ScreenIdConflict. Rebuild it as one screen — strip handlers/state/data-fetching, inline representative copy as literals, keep Tailwind classes verbatim (shadcn apps share Velloo's component vocabulary, so most refs map 1:1). (3) Component mapping is snippet-first, extension-second: a presentational custom component (FeatureCard, PricingRow) becomes a snippet with typed params — snippets render for real; a complex app-specific component (DataTable, charts) becomes `add_extension` with its real importPath — placeholder on canvas, real import on emit, so capture → redesign → emit never loses component identity. (4) Verify with `compare_to_url` against the running app at the same viewport — 0.85+ similarity is a faithful structural port; use the per-region node refs to fix what's off, and don't chase 1.0 (fonts and imagery legitimately differ). **If the result is `unverified`, STOP — similarity is meaningless there**: either the URL redirected to a login page / hit an auth wall (pass `storageStatePath`/`cookies`/`localStorage` to reach the real page), or `pageError` says the target app is throwing/blank (fix its dev server — the low score is the app being broken, not your design). If you can't get a real capture, leave the screen flagged unverified and tell the user rather than iterating against a page you never saw (a guess will land far from reality). Data-heavy pages: capture the structure with fixture copy — designs are static by construction. Known canvas-vs-app gaps to expect: `dark:` variant classes are inert (Velloo dark mode swaps token values, not a class — replace `bg-white dark:bg-background` patterns with the semantic token), Radix `AvatarImage` renders only after client-side load so SSR captures show the fallback (re-express avatars as `Image`), the app's vendored shadcn may predate the snapshot (e.g. an older `CardTitle` baked in `text-2xl` — re-add drifted classes explicitly), and the headless render substitutes some emoji glyphs and doesn't fetch remote images (an `i.pravatar.cc` avatar shows an initials/fallback box) — both are expected, so don't chase the small `compare_to_url` dip they cause; use `upload_asset` + local `Image`/`Placeholder` for art you need pixel-faithful.",
  "",
  '**Designer annotations**: `list_annotations(screenId)` returns markdown notes the designer attached to specific nodes on a screen. Treat them as guidance for the current screen — addressable feedback like "this CTA should land harder" or "tighten the copy." Each annotation carries a `resolved` path (null when the targeted node has been removed — low-priority, the designer\'s note is stale). You can also pin your own with `add_annotation` (author: "agent") — questions for the designer, review remarks — and remove your own with `remove_annotation`; user-authored annotations are read-only to you. Board-level guidance that isn\'t node-specific goes in canvas notes (`add_note`).',
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
 * predict. The feedback paragraph is appended only when opted in.
 */
export function buildInstructions(
  feedbackEnabled: boolean,
  canvasUrl?: string,
  tiered = false,
): string {
  const parts = [...INSTRUCTION_PARTS];
  if (tiered) parts.push("", revealInstructions());
  if (canvasUrl) {
    parts.push(
      "",
      `**The live canvas** is running at ${canvasUrl} — give the user this URL up front so they can open it and watch your edits render in real time. (They can also open a canvas any time with \`velloo run\`.)`,
    );
  }
  if (feedbackEnabled) parts.push("", FEEDBACK_INSTRUCTION);
  return parts.join("\n");
}

function buildMcpServer(
  ctx: MutationContext,
  jit: TailwindJit,
  bundler: LiveBundler,
  assetOrigin?: string,
  cloud?: CloudAuth,
): McpServer {
  const feedbackEnabled = Boolean(ctx.folder.config.feedback?.enabled);
  const tiered = !flatToolsMode();
  const mcp = new McpServer(
    { name: "velloo", version: "0.1.0" },
    { instructions: buildInstructions(feedbackEnabled, assetOrigin?.replace(/\/+$/, ""), tiered) },
  );
  // Instrument `registerTool` before any tool registers: rewrap each raw input
  // shape as z.strictObject (so a typo'd argument fails loudly with the valid
  // keys instead of being silently dropped) AND capture every tool's handle so
  // the disclosure tiers can hide/reveal it. The returned registry is keyed by
  // tool id.
  const registry = instrumentTools(mcp);
  // Hidden, env-gated session tape (VELLOO_TRACE). Wrap after instrumentTools
  // so every handler is taped; no-op when the flag is unset.
  const recorder = createTraceRecorder(ctx.folder.root);
  if (recorder) withCallRecording(mcp, recorder);
  registerDiscoveryTools(mcp, ctx);
  registerMutationTools(mcp, ctx);
  registerInspectTool(mcp, ctx);
  registerThemeTools(mcp, ctx);
  registerEmitTools(mcp, ctx);
  registerScreenshotTool(mcp, ctx, jit, bundler, assetOrigin);
  registerValidateTools(mcp, ctx, jit);
  registerExtensionTools(mcp, ctx);
  registerNoteTools(mcp, ctx);
  registerAssetTools(mcp, ctx);
  registerBatchTool(mcp, ctx);
  // Opt-in, auth-gated. The token may be absent (logged out) — the tool then
  // returns a "run velloo login" message rather than failing.
  if (feedbackEnabled) registerFeedbackTool(mcp, ctx, cloud ?? { url: "" });
  // Progressive disclosure: advertise a lean core and reveal the long-tail
  // families on demand via `reveal_tools`. VELLOO_MCP_FLAT opts out. Disabling
  // here is silent (the server isn't connected yet, so no list_changed fires —
  // the first tools/list simply reflects the hidden state).
  if (tiered) {
    registerRevealTool(mcp, registry);
    const { missing } = applyDefaultTiers(registry);
    if (missing.length > 0) {
      console.error(
        `velloo mcp: disclosure families reference unknown tools: ${missing.join(", ")}`,
      );
    }
  }
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
          const server = buildMcpServer(ctx, opts.jit, opts.bundler, opts.assetOrigin, opts.cloud);
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
  /** Canvas-server origin, used as <base href> in screenshot renders so /assets/* resolve. */
  assetOrigin?: string;
  cloud?: CloudAuth;
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
  const server = buildMcpServer(ctx, opts.jit, opts.bundler, opts.assetOrigin, opts.cloud);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return {
    async close() {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    },
  };
}
