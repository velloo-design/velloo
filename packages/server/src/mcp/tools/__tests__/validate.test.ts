import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { type DesignFolder, loadDesignFolder } from "../../../design-folder.ts";
import type { MutationContext } from "../../../mutations/index.ts";
import { migrateConfig } from "../../../providers.ts";
import { TailwindJit } from "../../../styles/tailwind-jit.ts";
import { registerValidateTools } from "../validate.ts";

const sampleConfig = {
  schemaVersion: 1 as const,
  toolVersion: "0.1.0",
  library: {
    id: "shadcn-react" as const,
    version: "test",
    source: "binary",
    componentsPath: "binary",
  },
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

const sampleTheme: Theme = {
  name: "default",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.205 0 0)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

const provider = createShadcnProvider();

interface ClassReport {
  class: string;
  valid: boolean;
  reason?: string;
  warning?: string;
}

/**
 * Capture the `validate_classes` callback off a stub MCP server, so the tool
 * can be driven directly without standing up a transport.
 */
function captureValidateTool(ctx: MutationContext, jit: TailwindJit) {
  type Handler = (args: {
    classes: string[];
  }) => Promise<{ content: { type: "text"; text: string }[] }>;
  let handler: Handler | null = null;
  const stub = {
    registerTool: (_name: string, _config: unknown, cb: Handler) => {
      handler = cb;
    },
  } as unknown as McpServer;
  registerValidateTools(stub, ctx, jit);
  if (handler === null) throw new Error("validate_classes was not registered");
  const run: Handler = handler;
  return async (classes: string[]): Promise<ClassReport[]> => {
    const res = await run({ classes });
    return (JSON.parse(res.content[0]?.text ?? "{}") as { reports: ClassReport[] }).reports;
  };
}

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let jit: TailwindJit;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-validate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeFile(
    join(tmp, ".design/config.json"),
    `${JSON.stringify(sampleConfig, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(tmp, "theme/default.json"),
    `${JSON.stringify(sampleTheme, null, 2)}\n`,
    "utf8",
  );
  folder = await loadDesignFolder(tmp);
  folder.config = migrateConfig(folder.config);
  ctx = {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: () => {},
  };
  jit = new TailwindJit(provider, join(tmp, "screens"), join(tmp, "snippets"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("validate_classes — undefined-var warnings", () => {
  test("a class referencing an undefined CSS var stays valid but warns", async () => {
    const validate = captureValidateTool(ctx, jit);
    const [report] = await validate(["text-[hsl(var(--primary-foreground))]"]);
    expect(report?.valid).toBe(true);
    expect(report?.warning).toBeDefined();
    expect(report?.warning).toContain("--primary-foreground");
    expect(report?.warning).toContain("fall back");
  });

  test("normal utilities — including ones that read --tw-* runtime vars — stay clean", async () => {
    const validate = captureValidateTool(ctx, jit);
    const reports = await validate([
      "bg-primary",
      "text-primary-foreground",
      "text-red-500",
      "ring-2",
      "shadow-lg",
      "transition",
    ]);
    for (const r of reports) {
      expect(r.valid).toBe(true);
      expect(r.warning).toBeUndefined();
    }
  });

  test("an arbitrary value with a wholly-undefined var warns on that var name", async () => {
    const validate = captureValidateTool(ctx, jit);
    const [report] = await validate(["bg-[var(--nope)]"]);
    expect(report?.valid).toBe(true);
    expect(report?.warning).toContain("--nope");
  });
});
