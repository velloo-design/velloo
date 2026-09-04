/**
 * Measures the MCP context cost an agent pays for Velloo: the instructions
 * string plus every advertised tool's wire-format schema (name + description +
 * JSON Schema), in approximate tokens (chars / 4). Registers the FULL tool
 * surface — a partial registration under-reports the number this script exists
 * to hold the line on.
 *
 *   bun packages/server/scripts/mcp-token-budget.ts
 *   bun packages/server/scripts/mcp-token-budget.ts --json   # machine-readable
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
import { applyToolPolicy } from "../src/mcp/tool-policy.ts";
import { registerAssetTools } from "../src/mcp/tools/assets.ts";
import { registerBatchTool } from "../src/mcp/tools/batch.ts";
import { registerCaptureTools } from "../src/mcp/tools/captures.ts";
import { registerCatalogTools } from "../src/mcp/tools/catalog.ts";
import { registerCommentTools } from "../src/mcp/tools/comments.ts";
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
import { registerValidateTools } from "../src/mcp/tools/validate.ts";
import type { MutationContext } from "../src/mutations/index.ts";

const tokens = (s: string): number => Math.ceil(s.length / 4);
const asJson = process.argv.includes("--json");

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

async function main(): Promise<void> {
  const tmp = await scaffoldFolder();
  try {
    const provider = createShadcnProvider();
    const folder = await loadDesignFolder(tmp);
    const ctx: MutationContext = {
      folder,
      providers: { "shadcn-react": provider },
      defaultProvider: provider,
      provider,
      broadcast: () => {},
    };

    const mcp = new McpServer({ name: "velloo", version: "0.1.0" });
    applyToolPolicy(mcp);
    // Schema measurement never invokes a handler, so the jit/bundler/comments
    // dependencies of the IO-bound tools can be inert stubs.
    const stub = <T>(): T => ({}) as T;
    registerDiscoveryTools(mcp, ctx);
    registerMutationTools(mcp, ctx);
    registerInspectTool(mcp, ctx);
    registerThemeTools(mcp, ctx);
    registerEmitTools(mcp, ctx);
    // Registers screenshot + compare_to_url + render_snippet.
    registerScreenshotTool(mcp, ctx, stub(), stub(), stub());
    registerValidateTools(mcp, ctx, stub());
    registerExtensionTools(mcp, ctx);
    registerCatalogTools(mcp, ctx);
    registerNoteTools(mcp, ctx);
    registerAssetTools(mcp, ctx);
    registerBatchTool(mcp, ctx);
    registerCaptureTools(mcp, ctx);
    registerCommentTools(mcp, stub());
    registerFeedbackTool(mcp, ctx, { url: "" });
    registerGenerateTools(mcp, ctx, { url: "" });
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

    const instructions = buildInstructions(false);
    const instrTokens = tokens(instructions);
    const boot = instrTokens + toolTotal + resourceTotal;

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            instructions: instrTokens,
            tools: toolTotal,
            toolCount: tools.length,
            resources: resourceTotal,
            resourceCount: resources.length,
            boot,
            perTool,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`\n== ${tools.length} tools, ~${toolTotal} tokens ==`);
      for (const t of perTool) console.log(`  ${String(t.tokens).padStart(6)}  ${t.name}`);
      console.log(`\ninstructions:      ~${instrTokens} tokens (${instructions.length} chars)`);
      console.log(`tools:             ~${toolTotal} tokens (${tools.length})`);
      console.log(`resource listing:  ~${resourceTotal} tokens (${resources.length})`);
      console.log(`─────────────────────────────────`);
      console.log(`boot context:      ~${boot} tokens`);
    }
    await client.close();
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

await main();
