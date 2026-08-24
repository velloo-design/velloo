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
import { type StyleChannelKind, styleChannelOf } from "@velloo/provider";
import type { CloudAuth } from "../cloud.ts";
import type { CanvasBundler } from "../live/canvas-bundler.ts";
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
import { registerCatalogTools } from "./tools/catalog.ts";
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
  canvasBundler: CanvasBundler;
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
  'You are working on a Velloo design folder. Components come from a pinned shadcn snapshot plus velloo helpers (`Box` for layout, `Heading`/`Text`, `Image`, `Gradient`, `Layer`, `SVG`, `Divider`, `Placeholder`). Designs are static — click handlers, routing, and forms are no-op. Use `Box` (a plain div) for every flex/grid wrapper — and `Box as="span"` / `"strong"` / `"a"` to render an *inline* element (inline tags get their natural inline display, so inline runs do not stack vertically); reserve `Card` for actual card surfaces (it ships card chrome; only *image* cards clip to the rounded corners, so an outside-the-box child — a `-top-3` "Most popular" badge — can overflow a bare Card).',
  "",
  'Before composing screens, call `list_components` (mode: "summary" first — the full schema is large; full mode includes an `example` of working props per component — copy it, then adapt) and `get_theme` for the palette and active tokens. Also `list_snippets` — reuse existing snippets before defining new ones. `list_boards` shows the boards; each board hosts frames pointing at screens. For an overview of an existing screen, use `get_screen mode: "outline"` before pulling the full JSON.',
  "",
  '**Prefer semantic theme tokens** (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `bg-accent`, etc.) over raw Tailwind palette colors (`bg-zinc-900`, `text-white`, `text-emerald-400`). Semantic tokens auto-flip under `screenshot mode: "dark"` and survive theme changes; raw palette colors render identically in both modes. Use raw palette only for *intentional* accent colors that should NOT theme-flip.',
  "",
  '**An object `style` prop is supported** for CSS no utility expresses cleanly (a `radial-gradient` dot-grid, a custom `backgroundSize`, a one-off `clipPath`): `{"$ref":"Box","props":{"style":{"backgroundImage":"radial-gradient(…)","backgroundSize":"14px 14px"}}}`. It renders inline and `emit_code` writes a `style={{…}}` JSX prop. Reach for utility/arbitrary classes first where they exist (they keep theme-awareness; classes passed through snippet *string params* compile fine); reserve `style` for literal CSS.',
  "",
  "**Native styling — `set_style`.** A folder targets a framework, and `set_style` routes your style payload to that framework's native channel: a Tailwind `className` string for shadcn (equivalent to setting `className` directly), an `sx` object for MUI, a plain `style` object for no-framework. Object channels merge shallowly (an inner `null` drops that key); `style: null` clears. A payload whose shape doesn't match the channel is rejected naming the expected shape. The token model from `get_theme` is shared across frameworks — prefer theme tokens over hard-coded values in any channel.",
  "",
  '`audit` is a **triage signal, not a gate**. It flags every color-bearing class that won\'t theme-flip — including ones you chose intentionally (brand gradients, status pill chrome). Read the per-node `problems[]` and decide; the coverage number is a guide, not a target. Set `data-accent: "ok"` (or any string) on a deliberately non-flipping node to exempt it from the audit and the score. Pass `snippetId` instead of `screenId` to audit a snippet body at definition time.',
  "",
  "**EFFICIENCY — build in big strokes, read once.** Velloo is designed so a screen takes a few dozen tool calls, not hundreds; over-calling is the most common failure, so follow these rules. (1) **`children` arrays are the default mental model** — `add_node` accepts a full subtree (every child can have its own props + children), so build a whole feature card or nav row in *one* call rather than node-by-node. (2) **`batch` groups a sequence of mutations into one round-trip** — atomic by default: on the first error every touched resource rolls back and the result reports `rolledBack: true` with the failing call (pass `atomic: false` for run-until-error without rollback). Use it instead of firing one tiny mutation per node. (3) **Read each source file and the screen tree once, then work from memory** — do NOT re-`get_screen`, re-`list_screens`/`list_boards`, or re-read files before every edit; to re-locate a node, `find_nodes` queries a screen by $ref / $id / className substring / prop value and returns its path — use it instead of fetching and walking the whole tree again. (4) **Don't thrash:** plan the structure before you build it (never add nodes then remove them to reshape), and edit a defined snippet through `update_snippet`'s `innerPatch` rather than redefining its whole body again and again.",
  "",
  '**Think in ids, not paths.** Anywhere a tool asks for a `path` (or `parentPath`, `fromPath`, `toParent`), pass a stable id reference like `"@hero-cta"`. Assign ids at creation (`id: "hero-cta"` on `add_node` / `instantiate_snippet`) for every node you might touch again — sections, CTAs, anything findable. Number paths are positional and break when siblings move; treat them as an implementation detail you get from `find_nodes` when no id exists yet (`set_node_id` retrofits one).',
  "",
  "**Three customization layers** stack additively in every folder:",
  "  - **Libraries** are the baseline component palette. A folder registers N (`config.libraries`); each screen pins one via `screen.library`. Multi-library lets marketing boards use no-lib while app boards use shadcn in the same folder. Component ids resolve against the screen's library only.",
  '  - **Extensions** add wholly new components the active library doesn\'t have — your app\'s custom `DataTable`, a brand `Hero`, a bespoke `PriceChart`. Register one with `add_extension`: placeholder card on the canvas, real `import` from its declared `importPath` on `emit_code`, folder-global, shadows a same-id library component. Use them for *additive customization*, NOT for compositions (snippets cover that). For a component whose look needs the real implementation — charts above all — register it with `render:"live"`: Velloo bundles the actual component from your app and mounts it in the canvas (and in `screenshot`/`compare_to_url`/`render_snippet`) for a pixel-faithful preview. The built-in `Chart` node previews via echarts without an extension, but it will NOT pixel-match an app built on recharts/visx/chart.js — porting a charts-heavy app, reach for a `render:"live"` extension of the app\'s own chart component.',
  '  - **Snippets** compose existing components (library + extension) into named subtrees with typed params. Use them for repeated structure (FeatureCard, NavRow, PricingTier). Reference a snippet with a `{"$snippet":"<kebab-id>"}` node or `instantiate_snippet` — NOT `$ref`, which is only for PascalCase library components / registered extensions. A PascalCase name that is actually a snippet (`$ref:"SiteHeader"` for the snippet `site-header`) is a common mix-up.',
  "",
  "Prefer snippets for repeated structure (feature cards, list items, hero sections). Create the snippet once with `add_snippet`, then call `instantiate_snippet` per occurrence. **Design snippets for variation up-front** — params are the contract. For a true one-off ('this instance, but with a red badge'), `override_snippet_props` patches a node inside one instance's body without forking the snippet; emit_code inlines such instances. Variation axes:",
  "",
  '  - `{"$if": "paramName", "then": <value>, "else": <value>}` — picks a branch by truthiness of `args.paramName`. **Boolean params only** (true/false). Non-boolean truthy values "work" via JS coercion but you\'ll trip on edge cases (empty string is falsy, the string `"false"` is truthy). Declare params as `type: "boolean"`.',
  "  - String params (`tone`, `variant`) for full-className swaps when the variation is more than two-way.",
  '  - `type: "node"` params for slot composition — the caller passes a full subtree: one node, or an array of nodes that render as siblings in the slot (`actions: [btnA, btnB]` is fine). Mark a may-or-may-not-be-there slot (a header `action`, a card `badge`) `optional: true`: omitted at instantiation it renders/emits nothing — no throwaway placeholder node. Cleaner than threading layout decisions through a string param. **For an icon that varies per instance**, use a `node` param, NOT an `icon` param: an `icon` param is one fixed lucide component baked into the emitted JSX (every instance renders the same glyph) — a `node` param emits as a `{slot}` filled per instance. Reserve `icon` params for a single icon chosen once at design time.',
  "  - `extraClassName` on `instantiate_snippet` / `update_snippet_args` — a one-off Tailwind suffix appended to the body root. Cascades through nested snippet roots (snippet-of-a-snippet still gets the override).",
  "",
  "**Always call `render_snippet` after `add_snippet`** to verify a new definition rendered as intended — `$param` wiring bugs (placeholder didn't expand, gradient missing, `$if` truthy-coerced wrong) are silent at definition time and only show up at instantiation. Preview before stamping. Snippets emit as real React components on `emit_code` with a typed `className?: string` prop.",
  "",
  "**Recipes — reach for the right tool** (this saves round-trips):",
  '  - Tweak one node in *one* snippet instance ("this card\'s badge is red") → `override_snippet_props` { path: instance, innerPath: "@id", propPatch }.',
  "  - Tweak one node across *all* instances of a snippet → `update_snippet` { patch: { innerPatch: { innerPath, propPatch } } } — no need to resend the body. Replace the whole body → `update_snippet` { patch: { tree } }. Change an instance's inputs (not the body) → `update_snippet_args`.",
  '  - The `children` *array* (`node.children`) is for nodes; a bare string/number there auto-wraps into an inline `Box as="span"` (so `children:["Most popular"]` just works). For **inline rich text** — a styled span mid-sentence, like a gradient word in a headline — put an array in the `children` *prop* mixing strings and nodes: `{"$ref":"Heading","props":{"children":["You get ",{"$ref":"Text","props":{"className":"text-primary","children":"the math right"}}]}}`. Text runs keep their exact spacing; inline nodes flow inline. A plain string `children` is still the common case.',
  "",
  "Screens have one tree; viewport size is a property of each `frame` placement on a board, not of the screen. Different viewport renderings of the same screen → multiple frames pointing at the same screen (edits sync). Different layouts per breakpoint → separate screens with their own frames. **A frame's `w`/`h` is canvas layout only** — `screenshot` / `compare_to_url` render at their *own* viewport (explicit `w`/`h`/`viewport` arg, defaulting to the Desktop preset), and `fullPage: true` (the default) captures the screen's full natural height — so a screenshot can look complete while the board frame still clips below the fold (a frame is a fixed `w×h` window). The returned `contentHeight` + `framesShorterThanContent` are your signal that a placement needs a taller frame (`update_frame`, or `fitFrames: true` in the same call) or the screen needs splitting.",
  "",
  '**Make it distinctive.** Default shadcn + Inter + one indigo reads as template. The personality levers: (1) `set_fonts` — declare a display face (role: "display" → class `font-display`) before composing; Google Fonts load in design mode and emit into globals.css. (2) `custom_css` — keyframes, grain/noise textures, clip-paths, ::selection. (3) `upload_asset` — author your own SVG/raster art (hero shapes, textures, marks) and reference it as `<Image src="/assets/…">`. (4) Theme tokens are yours: `derive_palette_from_color` / `set_token` an opinionated palette instead of living with the default. Big type, real art, confident color — then verify with screenshots.',
  "",
  'Text content for `Heading`, `Text`, `Button`, `Badge`, `Label` goes in the `children` prop, not a `text` prop. `Heading.level` controls only the HTML tag + a baked size ladder (h1 = text-5xl bold, h6 = text-lg semibold); override with `className` if you want a different size — but the className must include an explicit `text-*` size to win (a className with only spacing/weight like `mb-1 font-semibold` leaves the ladder size in place; add `text-base` to actually shrink it). `Icon` takes a lucide-react name as its `name` prop — PascalCase ("ArrowRight") or kebab-case ("arrow-right") both resolve; a name that matches no lucide icon renders the fallback "?" glyph and the mutation result carries an advisory warning. For placeholder imagery (avatars, hero shots) use the `Placeholder` component instead of faking with gradient divs.',
  "",
  '**Verification loop**: when a screen feels done, run `screenshot mode: "compare"` — returns one PNG with light + dark rendered side-by-side, the fastest signal that the design actually adapts. While iterating, `screenshot diff: true` compares against your previous capture: zero change costs no image at all, small changes return a highlight crop naming the changed nodes. Pass `scale: 0.5` when checking layout (smaller payload), and `path` to capture a single node close-up. Call `audit` to score the screen; coverage 1.0 + an empty problems list is the green light. `validate_classes` is free and fast — run it on any arbitrary-value classes (`shadow-[…]`, `grid-cols-[…]`, etc.) before relying on them. `inspect` returns SSR\'d HTML + resolved props for a specific node when you need to verify what landed.',
  "",
  "**Code-to-design (porting an existing app)**: *re-express — don't clone*. The loop: (1) `import_theme` with the app's globals.css (`cssPath` — absolute or relative to the host app root, since globals.css lives OUTSIDE the design folder; dry-run first, then `apply: true`) BEFORE any composition, so semantic slots, the raw `palette.*` passthrough (brand vars like `--ink`, scales like `--primary-600`), fonts, and the tailwind.config's `theme.extend`/`container` all resolve — then verbatim app classes like `bg-ink` render as-is. Tweak entries with `set_token palette.<name>`; run `validate_classes` if unsure a class resolved. (2) Read the page's source alongside `list_components`, then build INTO the route-scan's existing placeholder screen (clear the placeholder with `remove_node`; `add_screen` on a scanned route returns ScreenIdConflict). Strip handlers/state/data-fetching, inline representative copy as literals, keep Tailwind classes verbatim (shadcn apps share Velloo's component vocabulary, so most refs map 1:1). (3) Component mapping is snippet-first, extension-second: a presentational custom component (FeatureCard, PricingRow) becomes a snippet with typed params — snippets render for real; a complex app-specific component (DataTable, charts) becomes `add_extension` with its real importPath, so capture → redesign → emit never loses component identity. (4) Verify with `compare_to_url` at the same viewport — 0.85+ similarity is a faithful structural port; use the per-region node refs to fix what's off, and don't chase 1.0 (fonts and imagery legitimately differ). **If the result is `unverified`, STOP — similarity is meaningless there**: authenticate (`storageStatePath`/`cookies`/`localStorage`) or fix the target app's dev server, and if you can't get a real capture, leave the screen flagged unverified and tell the user rather than iterating against a page you never saw. Data-heavy pages: fixture copy — designs are static by construction. Known canvas-vs-app gaps to expect (don't chase the small similarity dip): `dark:` variant classes are inert (Velloo dark mode swaps token values, not a class — use the semantic token instead), Radix `AvatarImage` SSR-captures as its fallback (re-express avatars as `Image`), the app's vendored shadcn may predate the snapshot (re-add drifted classes explicitly), and the headless render substitutes some emoji and doesn't fetch remote images (use `upload_asset` + local `Image`/`Placeholder` for art you need pixel-faithful).",
  "",
  '**Designer annotations**: `list_annotations(screenId)` returns markdown notes attached to specific nodes. Treat them as addressable guidance ("this CTA should land harder"); a null `resolved` path means the targeted node is gone — low-priority. Pin your own with `add_annotation`, remove only your own. Board-level guidance that isn\'t node-specific goes in canvas notes (`add_note`).',
];

/**
 * Appended only when this folder opted into feedback (so the agent never sees
 * the tool, or guidance for it, otherwise). Mirrors the consent rules baked
 * into the tool description.
 */
const FEEDBACK_INSTRUCTION =
  "**Sending product feedback**: this folder opted into the `send_feedback` tool. Reach for it when you hit friction with **Velloo itself** — a confusing instruction, a missing capability, a tool that misbehaved, a bug — or when the user asks to send feedback. ALWAYS show the user the exact `body` and get their go-ahead before calling; never send unprompted, even when you originated the idea. Fire sparingly — one report per distinct issue, never repeated. NEVER include the user's design content, code, or file/repo paths; describe the issue in your own words. This is feedback about Velloo, not about the design.";

/**
 * Prepended for a MUI (sx-channel) folder so the agent is framed for Material UI
 * FIRST — the rest of INSTRUCTION_PARTS is shadcn/Tailwind-tuned, and this tells
 * the agent which of that guidance to ignore. (shadcn / no-lib folders use the
 * default Tailwind-shaped parts unchanged.)
 */
const MUI_INTRO = [
  "You are working on a **Material UI** Velloo design folder. Components are real MUI: `Box`/`Stack`/`Container`/`Paper` for layout, `Card`/`CardContent`/`CardHeader`/`CardActions`, `Typography` (ALL text — pick `variant` for the type scale; this is MUI's Heading+Text), `Button`/`IconButton`, `TextField`, `Chip`, `Divider`, `Avatar`, `List`/`ListItem`, `Table*`, `Tabs`/`Tab`, `Alert`, `Tooltip`, and the overlay surface `Dialog`/`Menu`/`Popover`/`Drawer`/`Snackbar` (rendered open + inline in design mode). Call `list_components` for the full set + per-component `example` props, and `get_theme` for the tokens. Designs are static — handlers/routing/forms are no-op.",
  "",
  '**Style with the `sx` object, not Tailwind classes.** Use `set_style { style: { display: "flex", alignItems: "center", gap: 2, p: 3, color: "primary.main" } }` — an object (merges shallowly; an inner `null` drops a key; `style: null` clears). `sx` keys are MUI system props; spacing is theme units (`p: 2` = 16px). `emit_code` emits idiomatic `<Component sx={{…}} />` importing from `@mui/material`; `emit_theme` emits a `createTheme(...)` module. **The Tailwind-specific guidance in the rest of these instructions — `className`, semantic utility tokens (`bg-background`, `text-muted-foreground`), `apply_classes`, the `audit` tool — is for shadcn folders and does NOT apply here.** Style via `sx` + the shared theme tokens (`get_theme`); the same abstract palette/spacing/radius/typography projects onto MUI.',
  "",
];

/**
 * Prepended for a no-framework (`none`) folder so the agent isn't told it has a
 * "shadcn snapshot": it's bare primitives + velloo helpers on Tailwind classes,
 * no shadcn component set. The rest of INSTRUCTION_PARTS (Box/Card layout,
 * Tailwind styling, audit) still applies — `none` is a Tailwind framework, only
 * the "shadcn snapshot" framing is corrected.
 */
const NONE_INTRO = [
  'You are working on a **no-framework** Velloo design folder — bare primitives, no component library. Despite mentions of "shadcn" below, THIS folder has only `Box`/`Stack`/`Container` for layout, `Card`, `Button`, `Input`, plus the velloo helpers (`Heading`/`Text`, `Image`, `Gradient`, `Layer`, `SVG`, `Divider`, `Placeholder`, `Icon`) — all wrapping plain HTML, styled with **Tailwind classes**. Call `list_components` for the exact set: there is NO shadcn surface (no `Badge`/`Avatar`/`Tabs`/`Dialog`/etc.), so build those from primitives or define snippets. The Box/Card layout + Tailwind styling guidance below all applies.',
  "",
];

/**
 * Prepended for a no-framework folder whose CSS framework is also `none` (the
 * inline-`style` channel). Same primitives as NONE_INTRO, but styling is plain
 * inline `style` objects with no Tailwind — so the Tailwind/className/audit
 * guidance below must be ignored.
 */
const NONE_INLINE_INTRO = [
  "You are working on a **no-framework** Velloo design folder with **no CSS framework** — bare primitives + velloo helpers (`Box`/`Stack`/`Container`, `Card`, `Button`, `Input`, `Heading`/`Text`, `Image`, `Icon`, `SVG`, `Divider`, `Gradient`, `Layer`, `Placeholder`) wrapping plain HTML, styled with **inline `style` objects** — there is no Tailwind here. Call `list_components` for the exact set; there is NO shadcn surface (no `Badge`/`Avatar`/`Tabs`/`Dialog`/etc.), so build those from primitives or snippets.",
  "",
  '**Style with the `style` object, not Tailwind classes.** Use `set_style { style: { display: "flex", gap: "16px", padding: "24px", borderRadius: "8px", color: "var(--color-foreground)" } }` — a plain React style object (merges shallowly; an inner `null` drops a key; `style: null` clears). Reference theme tokens as CSS variables (`var(--color-primary)`, `var(--color-muted-foreground)`, `var(--radius)`) from `get_theme` so the design stays themable. `emit_code` emits `style={{…}}` on plain elements (no imports, no Tailwind). **The Tailwind-specific guidance in the rest of these instructions — `className`, utility tokens (`bg-background`, `text-muted-foreground`), `apply_classes`, the `audit` tool — does NOT apply here; ignore it.**',
  "",
];

/**
 * The instructions string. `canvasUrl` (when the MCP boots alongside a canvas)
 * is surfaced so the agent can hand the user a URL to watch — important under
 * the stdio transport, where the canvas binds an ephemeral port the user can't
 * predict. The feedback paragraph is appended only when opted in. `channelKind`
 * + `providerId` frame the agent for the folder's framework (MUI ⇒ sx; no-lib ⇒
 * bare primitives; shadcn ⇒ the default framing).
 */
export function buildInstructions(
  feedbackEnabled: boolean,
  canvasUrl?: string,
  tiered = false,
  channelKind?: StyleChannelKind,
  providerId?: string,
): string {
  const intro =
    channelKind === "sx"
      ? MUI_INTRO
      : providerId === "none"
        ? channelKind === "style"
          ? NONE_INLINE_INTRO
          : NONE_INTRO
        : [];
  const parts = [...intro, ...INSTRUCTION_PARTS];
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
  canvasBundler: CanvasBundler,
  assetOrigin?: string,
  cloud?: CloudAuth,
): McpServer {
  const feedbackEnabled = Boolean(ctx.folder.config.feedback?.enabled);
  const tiered = !flatToolsMode();
  const channelKind = styleChannelOf(
    ctx.defaultProvider,
    ctx.folder.config.styling?.framework,
  ).kind;
  const mcp = new McpServer(
    { name: "velloo", version: "0.1.0" },
    {
      instructions: buildInstructions(
        feedbackEnabled,
        assetOrigin?.replace(/\/+$/, ""),
        tiered,
        channelKind,
        ctx.defaultProvider.id,
      ),
    },
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
  registerScreenshotTool(mcp, ctx, jit, bundler, canvasBundler, assetOrigin);
  registerValidateTools(mcp, ctx, jit);
  registerExtensionTools(mcp, ctx);
  registerCatalogTools(mcp, ctx);
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
          const server = buildMcpServer(
            ctx,
            opts.jit,
            opts.bundler,
            opts.canvasBundler,
            opts.assetOrigin,
            opts.cloud,
          );
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
  canvasBundler: CanvasBundler;
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
  const server = buildMcpServer(
    ctx,
    opts.jit,
    opts.bundler,
    opts.canvasBundler,
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
