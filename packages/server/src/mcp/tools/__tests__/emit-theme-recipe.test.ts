import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ComponentProvider } from "@velloo/provider";
import { createProvider as createMuiProvider } from "@velloo/provider-mui";
import { createProvider as createNoneProvider } from "@velloo/provider-none";
import { RepoComponents } from "../../../repo/catalog.ts";
import {
  type DesignConfigOverrides,
  designConfig,
  testContext,
} from "../../../testing/design-folder.ts";
import { registerEmitTools } from "../emit.ts";
import type { McpResult } from "../result.ts";

/**
 * `emit_theme` across the two tiers a library can arrive through. A recipe used
 * to be reachable only through a literal `adapter.id === "none"` check, so a
 * Mantine app in a shadcn or MUI folder had no path to the Mantine theme at
 * all — these are that gate's failures, and the coexistence it ruled out.
 */

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpResult>;

interface ThemeEmit {
  files: { path: string; contents: string }[];
  notes?: string[];
}

let out: string;
let host: string;
const folders: { cleanup(): Promise<void> }[] = [];

/** A host app with Mantine installed — all `recipesForHost` asks of it. */
async function mantineHost(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "velloo-mantine-host-"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "host" }));
  const pkg = join(root, "node_modules", "@mantine", "core");
  await mkdir(pkg, { recursive: true });
  await writeFile(
    join(pkg, "package.json"),
    JSON.stringify({ name: "@mantine/core", version: "7.0.0", main: "index.js" }),
  );
  await writeFile(join(pkg, "index.js"), "");
  return root;
}

async function emitTheme(
  opts: { provider?: ComponentProvider; config?: DesignConfigOverrides; hostApp?: boolean } = {},
): Promise<ThemeEmit> {
  const folder = await testContext({
    label: "emit-theme-recipe",
    nested: true,
    ...(opts.provider ? { provider: opts.provider } : {}),
    config: designConfig({
      ...(opts.hostApp === false ? {} : { hostApp: { root: host } }),
      ...opts.config,
    }),
  });
  folders.push(folder);
  folder.ctx.repo = new RepoComponents({
    folderRoot: folder.root,
    config: () => folder.ctx.folder.config,
    reservedIds: () => new Set(),
  });
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerEmitTools(mcp, folder.ctx, { provider: folder.ctx.defaultProvider } as never);
  const tool = (mcp as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })
    ._registeredTools.emit_theme;
  if (!tool) throw new Error("emit_theme not registered");
  const r = await tool.handler({ outputDir: out }, {});
  return JSON.parse(r.content[0]?.type === "text" ? r.content[0].text : "{}") as ThemeEmit;
}

const named = (r: ThemeEmit, name: string): string | undefined =>
  r.files.find((file) => basename(file.path) === name)?.contents;

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), "velloo-emit-theme-out-"));
  host = await mantineHost();
});
afterEach(async () => {
  for (const folder of folders.splice(0)) await folder.cleanup();
  await rm(out, { recursive: true, force: true });
  await rm(host, { recursive: true, force: true });
});

describe("emit_theme with a framework recipe", () => {
  test("the recipe's theme is emitted whatever adapter the folder uses", async () => {
    // A shadcn folder: Tailwind is still the adapter's own artifact, and the
    // app's Mantine components get their theme alongside it rather than nothing.
    const r = await emitTheme();
    expect(named(r, "globals.css")).toBeDefined();
    expect(named(r, "theme.ts")).toContain('import { createTheme } from "@mantine/core"');
    expect(named(r, "theme.ts")).toContain('primaryColor: "velloo"');
    expect(r.notes?.join(" ")).toContain("Mantine");
    // Mantine's module stays unqualified — the adapter has none to share the
    // path with — and only the stylesheet artifact writes the token file.
    expect(r.files.map((file) => basename(file.path)).sort()).toEqual([
      "globals.css",
      "tailwind.config.ts",
      "theme.ts",
      "tokens.json",
      "typeset.css",
    ]);
  });

  test("an adapter's native theme and a recipe's sit side by side", async () => {
    const r = await emitTheme({
      provider: createMuiProvider(),
      config: { library: { id: "mui", version: "6", source: "binary", componentsPath: "binary" } },
    });
    // The adapter keeps the default path; the recipe qualifies by its id, so
    // neither createTheme module overwrites the other.
    expect(named(r, "theme.ts")).toContain("@mui/material/styles");
    expect(named(r, "theme-mantine.ts")).toContain("@mantine/core");
    // One framework-neutral token file, not one per module.
    expect(r.files.filter((file) => basename(file.path) === "tokens.json")).toHaveLength(1);
  });

  test("a no-framework folder gets both the recipe module and its own CSS variables", async () => {
    // Mantine components take the Mantine theme; the velloo primitives beside
    // them emit `var(--…)` markup, so the variables are owed too.
    const r = await emitTheme({
      provider: createNoneProvider(),
      config: {
        library: { id: "none", version: "t", source: "binary", componentsPath: "binary" },
        styling: { framework: "none" },
      },
    });
    expect(named(r, "velloo-theme.css")).toContain("--color-primary");
    expect(named(r, "theme.ts")).toContain("@mantine/core");
  });

  test("a host with no recipe library emits the adapter's artifact alone", async () => {
    const r = await emitTheme({ hostApp: false });
    expect(r.files.some((file) => basename(file.path) === "globals.css")).toBe(true);
    expect(r.files.some((file) => basename(file.path).startsWith("theme"))).toBe(false);
    expect(r.notes?.join(" ") ?? "").not.toContain("Mantine");
  });
});
