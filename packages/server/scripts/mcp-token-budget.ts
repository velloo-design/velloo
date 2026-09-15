/**
 * Measures the MCP context cost an agent pays for Velloo: the instructions
 * string plus every advertised tool's wire-format schema (name + description +
 * JSON Schema), in approximate tokens (chars / 4). Registers the FULL tool
 * surface — a partial registration under-reports the number this script exists
 * to hold the line on.
 *
 *   bun packages/server/scripts/mcp-token-budget.ts
 *   bun packages/server/scripts/mcp-token-budget.ts --json   # machine-readable
 *   bun packages/server/scripts/mcp-token-budget.ts --check  # CI regression guard
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { loadDesignFolder } from "../src/design-folder.ts";
import { registerGuideResources } from "../src/mcp/resources.ts";
import { buildInstructions } from "../src/mcp/server.ts";
import { applyMcpToolSurface, type McpSurfaceSelection } from "../src/mcp/surface.ts";
import { applyToolPolicy } from "../src/mcp/tool-policy.ts";
import { registerAssetTools } from "../src/mcp/tools/assets.ts";
import { registerBatchTool } from "../src/mcp/tools/batch.ts";
import { registerCaptureTools } from "../src/mcp/tools/captures.ts";
import { registerCommentTools } from "../src/mcp/tools/comments.ts";
import { registerComposeTool } from "../src/mcp/tools/compose.ts";
import { registerDiscoveryTools } from "../src/mcp/tools/discovery.ts";
import { registerEmitTools } from "../src/mcp/tools/emit.ts";
import { registerExtensionTools } from "../src/mcp/tools/extensions.ts";
import { registerFeedbackTool } from "../src/mcp/tools/feedback.ts";
import { registerGenerateTools } from "../src/mcp/tools/generate.ts";
import { registerInspectTool } from "../src/mcp/tools/inspect.ts";
import { registerMutationTools } from "../src/mcp/tools/mutations.ts";
import { registerNoteTools } from "../src/mcp/tools/notes.ts";
import { registerScreenshotTool } from "../src/mcp/tools/screenshot.ts";
import { registerThemeTools } from "../src/mcp/tools/theme.ts";
import type { MutationContext } from "../src/mutations/index.ts";

const tokens = (s: string): number => Math.ceil(s.length / 4);
const asJson = process.argv.includes("--json");
const check = process.argv.includes("--check");
/** Measured before the compact-surface work; kept here so savings stay visible. */
const LEGACY_BOOT_TOKENS = 19_610;
// Audited full-surface baseline (~18,974) plus ~1.5% headroom. This stays
// below the pre-guided legacy cost while catching meaningful schema growth.
const FULL_BOOT_BUDGET_TOKENS = 19_250;
const GUIDED_BOOT_BUDGET_TOKENS = 4_000;

async function scaffoldFolder(): Promise<string> {
  const tmp = join(tmpdir(), `velloo-budget-${Date.now()}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  const writeJson = (p: string, v: unknown) =>
    writeFile(p, `${JSON.stringify(v, null, 2)}\n`, "utf8");
  await writeJson(join(tmp, ".design/config.json"), {
    schemaVersion: 3,
    toolVersion: "0.1.0",
    libraries: {
      default: {
        id: "shadcn-upstream",
        version: "test",
        source: "binary",
        componentsPath: "binary",
      },
    },
    defaultLibrary: "default",
    viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
  });
  await writeJson(join(tmp, "theme/default.json"), {
    name: "default",
    colors: {
      background: "#fff",
      foreground: "#000",
      primary: { DEFAULT: "#000", foreground: "#fff" },
    },
    typography: {},
    spacing: {},
    radius: {},
  });
  await writeJson(join(tmp, "screens/landing.json"), {
    id: "landing",
    name: "Landing",
    tree: { $ref: "Box", props: {}, children: [] },
  });
  return tmp;
}

async function measure(ctx: MutationContext, selection: McpSurfaceSelection) {
  const mcp = new McpServer({ name: "velloo", version: "0.1.0" });
  const surface = applyMcpToolSurface(mcp, selection);
  applyToolPolicy(mcp);
  // Schema measurement never invokes a handler, so the jit/bundler/comments
  // dependencies of the IO-bound tools can be inert stubs.
  const stub = <T>(): T => ({}) as T;
  registerDiscoveryTools(mcp, ctx);
  registerComposeTool(mcp, ctx);
  registerMutationTools(mcp, ctx);
  registerInspectTool(mcp, ctx, stub(), stub(), stub());
  registerThemeTools(mcp, ctx);
  registerEmitTools(mcp, ctx);
  // Registers screenshot + compare_to_url + render_snippet.
  registerScreenshotTool(mcp, ctx, stub(), stub(), stub());
  registerExtensionTools(mcp, ctx);
  registerNoteTools(mcp, ctx);
  registerAssetTools(mcp, ctx);
  registerBatchTool(mcp, ctx);
  registerCaptureTools(mcp, ctx);
  registerCommentTools(mcp, stub());
  registerFeedbackTool(mcp, ctx, { url: "" });
  registerGenerateTools(mcp, ctx, { url: "" });
  surface.finish();
  registerGuideResources(mcp);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "budget", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), mcp.connect(serverTransport)]);

  const { tools } = await client.listTools();
  const perTool = tools
    .map((t) => ({ name: t.name, tokens: tokens(JSON.stringify(t)) }))
    .sort((a, b) => b.tokens - a.tokens);
  const toolTotal = perTool.reduce((sum, t) => sum + t.tokens, 0);

  // Resources cost their listing only — the body is fetched on demand, so it
  // is not part of what every session pays.
  const { resources } = await client.listResources();
  const resourceTotal = tokens(JSON.stringify(resources));

  const instructions = buildInstructions(false, undefined, [], 0, null, false, selection);
  const instrTokens = tokens(instructions);
  const boot = instrTokens + toolTotal + resourceTotal;
  const savings = LEGACY_BOOT_TOKENS - boot;
  await client.close();
  return {
    surface: selection.mode,
    instructions: instrTokens,
    tools: toolTotal,
    toolCount: tools.length,
    resources: resourceTotal,
    resourceCount: resources.length,
    boot,
    legacyBoot: LEGACY_BOOT_TOKENS,
    savings,
    savingsPercent: Number(((savings / LEGACY_BOOT_TOKENS) * 100).toFixed(1)),
    perTool,
  };
}

async function main(): Promise<void> {
  const tmp = await scaffoldFolder();
  try {
    const provider = createShadcnProvider();
    const folder = await loadDesignFolder(tmp);
    const ctx: MutationContext = {
      folder,
      providers: { [provider.id]: provider },
      defaultProvider: provider,
      broadcast: () => {},
    };
    const [guided, full] = await Promise.all([
      measure(ctx, { mode: "guided" }),
      measure(ctx, { mode: "full" }),
    ]);

    if (asJson) {
      console.log(JSON.stringify({ defaultSurface: "guided", guided, full }, null, 2));
    } else {
      for (const result of [guided, full]) {
        const budget =
          result.surface === "guided" ? GUIDED_BOOT_BUDGET_TOKENS : FULL_BOOT_BUDGET_TOKENS;
        console.log(
          `\n== ${result.surface}: ${result.toolCount} tools, ~${result.tools} tool tokens ==`,
        );
        for (const tool of result.perTool)
          console.log(`  ${String(tool.tokens).padStart(6)}  ${tool.name}`);
        console.log(`instructions:      ~${result.instructions} tokens`);
        console.log(`resource listing:  ~${result.resources} tokens (${result.resourceCount})`);
        console.log(`boot context:      ~${result.boot} tokens`);
        console.log(`budget:            ~${budget} tokens`);
      }
      console.log(
        `\ndefault guided saving: ~${guided.savings} tokens (${guided.savingsPercent}%) vs legacy`,
      );
    }
    if (check && guided.boot > GUIDED_BOOT_BUDGET_TOKENS) {
      throw new Error(
        `guided MCP boot context ~${guided.boot} exceeds ~${GUIDED_BOOT_BUDGET_TOKENS}`,
      );
    }
    if (check && full.boot > FULL_BOOT_BUDGET_TOKENS) {
      throw new Error(`full MCP boot context ~${full.boot} exceeds ~${FULL_BOOT_BUDGET_TOKENS}`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

await main();
