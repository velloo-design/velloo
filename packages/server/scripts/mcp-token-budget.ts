/**
 * Measures the MCP context cost an agent pays for Velloo: the instructions
 * string plus every advertised tool's wire-format schema (name + description +
 * JSON Schema), in approximate tokens (chars / 4). Reports the tiered core
 * surface (what a session sees at boot) and the fully-revealed surface.
 *
 *   bun packages/server/scripts/mcp-token-budget.ts
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { loadDesignFolder } from "../src/design-folder.ts";
import { buildInstructions } from "../src/mcp/server.ts";
import {
  applyDefaultTiers,
  instrumentTools,
  registerRevealTool,
  revealFamily,
} from "../src/mcp/tiers.ts";
import { registerAssetTools } from "../src/mcp/tools/assets.ts";
import { registerBatchTool } from "../src/mcp/tools/batch.ts";
import { registerCatalogTools } from "../src/mcp/tools/catalog.ts";
import { registerDiscoveryTools } from "../src/mcp/tools/discovery.ts";
import { registerEmitTools } from "../src/mcp/tools/emit.ts";
import { registerExtensionTools } from "../src/mcp/tools/extensions.ts";
import { registerGenerateTools } from "../src/mcp/tools/generate.ts";
import { registerInspectTool } from "../src/mcp/tools/inspect.ts";
import { registerMutationTools } from "../src/mcp/tools/mutations.ts";
import { registerNoteTools } from "../src/mcp/tools/notes.ts";
import { registerScreenshotTool } from "../src/mcp/tools/screenshot.ts";
import { registerThemeTools } from "../src/mcp/tools/theme.ts";
import { registerValidateTools } from "../src/mcp/tools/validate.ts";
import type { MutationContext } from "../src/mutations/index.ts";

const tokens = (s: string): number => Math.ceil(s.length / 4);

async function scaffoldFolder(): Promise<string> {
  const tmp = join(tmpdir(), `velloo-budget-${Date.now()}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  const writeJson = (p: string, v: unknown) =>
    writeFile(p, `${JSON.stringify(v, null, 2)}\n`, "utf8");
  await writeJson(join(tmp, ".design/config.json"), {
    schemaVersion: 2,
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
    const registry = instrumentTools(mcp);
    // Schema measurement never invokes a handler, so the jit/bundler
    // dependencies of the screenshot/validate tools can be inert stubs.
    const stub = <T>(): T => ({}) as T;
    registerDiscoveryTools(mcp, ctx);
    registerMutationTools(mcp, ctx);
    registerInspectTool(mcp, ctx);
    registerThemeTools(mcp, ctx);
    registerEmitTools(mcp, ctx);
    registerScreenshotTool(mcp, ctx, stub(), stub(), stub());
    registerValidateTools(mcp, ctx, stub());
    registerExtensionTools(mcp, ctx);
    registerCatalogTools(mcp, ctx);
    registerNoteTools(mcp, ctx);
    registerAssetTools(mcp, ctx);
    registerBatchTool(mcp, ctx);
    registerGenerateTools(mcp, ctx, { url: "" });
    registerRevealTool(mcp, registry);
    applyDefaultTiers(registry);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "budget", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), mcp.connect(serverTransport)]);

    const measure = async (label: string) => {
      const { tools } = await client.listTools();
      const perTool = tools
        .map((t) => ({ name: t.name, tokens: tokens(JSON.stringify(t)) }))
        .sort((a, b) => b.tokens - a.tokens);
      const total = perTool.reduce((sum, t) => sum + t.tokens, 0);
      console.log(`\n== ${label}: ${tools.length} tools, ~${total} tokens ==`);
      for (const t of perTool) console.log(`  ${String(t.tokens).padStart(6)}  ${t.name}`);
      return total;
    };

    const instructions = buildInstructions(false, undefined, true);
    const instrTokens = tokens(instructions);
    console.log(`instructions: ~${instrTokens} tokens (${instructions.length} chars)`);

    const coreTotal = await measure("core surface (tiered boot default)");
    revealFamily(registry, "all");
    const fullTotal = await measure("full surface (all families revealed)");

    console.log(`\nboot context (instructions + core tools): ~${instrTokens + coreTotal} tokens`);
    console.log(`max context (instructions + all tools):    ~${instrTokens + fullTotal} tokens`);
    await client.close();
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

await main();
