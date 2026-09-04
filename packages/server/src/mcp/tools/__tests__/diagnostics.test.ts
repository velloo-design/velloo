import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { type DesignFolder, loadDesignFolder } from "../../../design-folder.ts";
import type { MutationContext } from "../../../mutations/index.ts";
import { TailwindJit } from "../../../styles/tailwind-jit.ts";
import type { DesignDiagnostic } from "../../diagnostics.ts";
import { registerMutationTools } from "../mutations.ts";

const sampleConfig = {
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

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: "text"; text: string }[];
}>;

function captureMutationTool(ctx: MutationContext, jit: TailwindJit, wanted: string): ToolHandler {
  let handler: ToolHandler | undefined;
  const stub = {
    registerTool: (name: string, _config: unknown, cb: ToolHandler) => {
      if (name === wanted) handler = cb;
    },
  } as unknown as McpServer;
  registerMutationTools(stub, ctx, jit);
  if (!handler) throw new Error(`${wanted} was not registered`);
  return handler;
}

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let jit: TailwindJit;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-diagnostics-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
  await writeFile(
    join(tmp, "screens/landing.json"),
    `${JSON.stringify({
      id: "landing",
      name: "Landing",
      tree: { $ref: "Box", props: {}, children: [] },
    })}\n`,
    "utf8",
  );
  const provider = createShadcnProvider();
  folder = await loadDesignFolder(tmp);
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

describe("automatic mutation diagnostics", () => {
  test("add_node returns path-located class and theme warnings", async () => {
    const addNode = captureMutationTool(ctx, jit, "add_node");
    const result = await addNode({
      screenId: "landing",
      parentPath: [],
      componentRef: "Box",
      props: { className: "not-a-tailwind-utility bg-red-500" },
    });
    const value = JSON.parse(result.content[0]?.text ?? "{}") as {
      diagnostics?: DesignDiagnostic[];
    };

    expect(value.diagnostics?.map((diagnostic) => diagnostic.code)).toContain(
      "tailwind/invalid-class",
    );
    expect(value.diagnostics?.map((diagnostic) => diagnostic.code)).toContain("theme/raw-color");
    expect(value.diagnostics?.every((diagnostic) => diagnostic.path.join(".") === "0")).toBe(true);
  });

  test("clean semantic utilities omit diagnostics", async () => {
    const addNode = captureMutationTool(ctx, jit, "add_node");
    const result = await addNode({
      screenId: "landing",
      parentPath: [],
      componentRef: "Box",
      props: { className: "bg-background text-foreground p-4" },
    });
    const value = JSON.parse(result.content[0]?.text ?? "{}") as {
      diagnostics?: DesignDiagnostic[];
    };
    expect(value.diagnostics).toBeUndefined();
  });

  test("undefined CSS variables remain valid but return a warning", async () => {
    const addNode = captureMutationTool(ctx, jit, "add_node");
    const result = await addNode({
      screenId: "landing",
      parentPath: [],
      componentRef: "Box",
      props: { className: "bg-[var(--missing-brand)]" },
    });
    const value = JSON.parse(result.content[0]?.text ?? "{}") as {
      diagnostics?: DesignDiagnostic[];
    };
    expect(
      value.diagnostics?.some((diagnostic) => diagnostic.code === "tailwind/undefined-var"),
    ).toBe(true);
  });
});
