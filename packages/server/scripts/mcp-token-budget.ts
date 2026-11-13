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
import type { FrameworkAdapter } from "@velloo/provider";
import { createProvider as createHtmlProvider } from "@velloo/provider-html";
import { createProvider as createShadcnProvider } from "@velloo/provider-shadcn-upstream";
import { loadDesignFolder } from "../src/design-folder.ts";
import type { LocalCommentsService } from "../src/local-comments.ts";
import type { SessionDesigns } from "../src/mcp/designs.ts";
import { buildMcpServer } from "../src/mcp/server.ts";
import type { McpSurfaceSelection } from "../src/mcp/surface.ts";
import type { MutationContext } from "../src/mutations/index.ts";

const tokens = (s: string): number => Math.ceil(s.length / 4);
const asJson = process.argv.includes("--json");
const check = process.argv.includes("--check");
/** Measured before the compact-surface work; kept here so savings stay visible. */
const LEGACY_BOOT_TOKENS = 19_610;
// The full surface as a session gets it: ~19,360, with a thin margin. Until
// the script built sessions through `buildMcpServer` it registered a
// hand-kept list that had missed nine tools (sketchbook, Look, design
// language, repo setup, host files) — ~23,211 in truth against a guarded
// ~19,588. Description trims bought back ~2,050 and `leanToolListing` (no
// `$schema`, no default `execution` on the wire) ~1,800, so the next addition
// should pay for itself in trims too.
//
// Guide BODIES (`velloo://guide/*`) are not counted here, only the one-line
// blurb in the resource listing, so prose moved into a guide is free.
const FULL_BOOT_BUDGET_TOKENS = 19_400;
const GUIDED_BOOT_BUDGET_TOKENS = 4_000;
/**
 * What a session in a checkout with several designs adds on top: the design
 * instruction and `list_designs`/`switch_design`. Single-design sessions — the
 * ones the budgets above measure — pay none of it.
 */
const MULTI_DESIGN_INCREMENT_TOKENS = 250;
const MULTI_DESIGNS: SessionDesigns = {
  current: "web",
  names: ["admin", "brand", "web"],
  switchable: true,
  pick: undefined,
};

async function scaffoldFolder(): Promise<string> {
  const tmp = join(tmpdir(), `velloo-budget-${Date.now()}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  const writeJson = (p: string, v: unknown) =>
    writeFile(p, `${JSON.stringify(v, null, 2)}\n`, "utf8");
  await writeJson(join(tmp, ".design/config.json"), {
    schemaVersion: 4,
    name: "test",
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
    // Opted in, so `send_feedback` and its paragraph are counted.
    feedback: { enabled: true, contactOk: false },
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

async function measure(
  ctx: MutationContext,
  selection: McpSurfaceSelection,
  designs: SessionDesigns | null = null,
) {
  // The daemon's own builder, so a tool registered for sessions is a tool
  // measured here. Schema measurement never invokes a handler, so the
  // jit/bundler/comments dependencies can be inert stubs.
  const stub = <T>(value: object = {}): T => value as T;
  const mcp = buildMcpServer(ctx, {
    jit: stub(),
    bundler: stub(),
    canvasBundler: stub(),
    comments: stub<LocalCommentsService>({ countOpenSync: () => 2 }),
    assetOrigin: "http://127.0.0.1:7395",
    cloud: { url: "https://cloud.invalid" },
    surface: selection,
    designs,
  });

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

  const instrTokens = tokens(client.getInstructions() ?? "");
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

/**
 * Every tool a session can be handed, which depends on the folder: the
 * budgets hold for the largest of these. Feedback is opted into (above) and a
 * cloud is configured, so `send_feedback` counts; the HTML folder adds
 * `store_host_files`, which only a design styled by the app's own stylesheets
 * registers. One design per checkout — several are the increment below.
 */
const FOLDERS: Record<string, () => FrameworkAdapter> = {
  shadcn: createShadcnProvider,
  html: createHtmlProvider,
};

type Measured = Awaited<ReturnType<typeof measure>>;

async function main(): Promise<void> {
  const tmp = await scaffoldFolder();
  try {
    const folder = await loadDesignFolder(tmp);
    const largest: Record<"guided" | "full", Measured & { folder: string }> = {} as never;
    let increments = { guided: 0, full: 0 };
    for (const [name, create] of Object.entries(FOLDERS)) {
      const provider = create();
      const ctx: MutationContext = {
        folder,
        providers: { [provider.id]: provider },
        defaultProvider: provider,
        broadcast: () => {},
      };
      const [guided, full, guidedMulti, fullMulti] = await Promise.all([
        measure(ctx, { mode: "guided" }),
        measure(ctx, { mode: "full" }),
        measure(ctx, { mode: "guided" }, MULTI_DESIGNS),
        measure(ctx, { mode: "full" }, MULTI_DESIGNS),
      ]);
      for (const result of [guided, full]) {
        const mode = result.surface as "guided" | "full";
        if (!largest[mode] || result.boot > largest[mode].boot) {
          largest[mode] = { ...result, folder: name };
        }
      }
      increments = {
        guided: Math.max(increments.guided, guidedMulti.boot - guided.boot),
        full: Math.max(increments.full, fullMulti.boot - full.boot),
      };
    }
    const { guided, full } = largest;

    if (asJson) {
      console.log(
        JSON.stringify(
          { defaultSurface: "guided", guided, full, severalDesigns: increments },
          null,
          2,
        ),
      );
    } else {
      for (const result of [guided, full]) {
        const budget =
          result.surface === "guided" ? GUIDED_BOOT_BUDGET_TOKENS : FULL_BOOT_BUDGET_TOKENS;
        console.log(
          `\n== ${result.surface} (${result.folder} folder, the largest): ${result.toolCount} tools, ~${result.tools} tool tokens ==`,
        );
        for (const tool of result.perTool)
          console.log(`  ${String(tool.tokens).padStart(6)}  ${tool.name}`);
        console.log(`instructions:      ~${result.instructions} tokens`);
        console.log(`resource listing:  ~${result.resources} tokens (${result.resourceCount})`);
        console.log(`boot context:      ~${result.boot} tokens`);
        console.log(`budget:            ~${budget} tokens`);
      }
      console.log(
        `\nseveral designs add: ~${increments.guided} guided / ~${increments.full} full tokens (budget ~${MULTI_DESIGN_INCREMENT_TOKENS})`,
      );
      console.log(
        `\ndefault guided saving: ~${guided.savings} tokens (${guided.savingsPercent}%) vs legacy`,
      );
    }
    if (check && guided.boot > GUIDED_BOOT_BUDGET_TOKENS) {
      throw new Error(
        `guided MCP boot context ~${guided.boot} exceeds ~${GUIDED_BOOT_BUDGET_TOKENS}`,
      );
    }
    for (const [surface, added] of Object.entries(increments)) {
      if (check && added > MULTI_DESIGN_INCREMENT_TOKENS) {
        throw new Error(
          `several designs add ~${added} ${surface} MCP boot tokens, over ~${MULTI_DESIGN_INCREMENT_TOKENS}`,
        );
      }
    }
    if (check && full.boot > FULL_BOOT_BUDGET_TOKENS) {
      throw new Error(`full MCP boot context ~${full.boot} exceeds ~${FULL_BOOT_BUDGET_TOKENS}`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

await main();
